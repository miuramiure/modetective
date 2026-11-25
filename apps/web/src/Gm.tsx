/** GM画面 */
import { useEffect, useState, type FormEvent } from "react";
import {
  PHASES,
  PHASE_LABELS,
  type GMView,
  type MemberSummary,
  type Phase,
  type Settings,
  type TeamView,
} from "@mdt/core";
import { net, useNet } from "./net";
import {
  CopyButton,
  ErrorText,
  Qr,
  Score,
  Steps,
  script,
  settingsSummary,
} from "./parts";
import { SettingsForm } from "./SettingsForm";
import { storage } from "./storage";

const NEXT_LABEL: Record<Phase, string> = {
  lobby: "カードを配る",
  card: "調査フェーズへ",
  investigate: "推理フェーズへ",
  deduce: "解決編へ",
  reveal: "振り返りへ",
  review: "次のセット",
};

export function playerUrl(code: string): string {
  return `${location.origin}${location.pathname}?r=${code}`;
}

export function Gm({ code, onLeave }: { code: string; onLeave: () => void }) {
  const st = useNet();
  const view = st.view?.role === "gm" && st.view.code === code ? st.view : null;

  useEffect(() => {
    const token = storage.token("gm", code);
    if (token && !net.isCurrent("gm", code))
      net.start({ kind: "gm", code, token }, true);
  }, [code]);

  if (st.notice === "closed") {
    return (
      <Message title="部屋が閉じられました" onLeave={onLeave}>
        最後の操作から48時間たったので、この部屋は消えました。新しい部屋を作ってください。
      </Message>
    );
  }
  if (!view && (st.resumeError || !storage.token("gm", code))) {
    return (
      <GmLogin
        code={code}
        reason={st.resumeError?.message ?? null}
        onLeave={onLeave}
      />
    );
  }
  if (!view) return <p className="loading">読み込み中…</p>;
  return <GmRoom view={view} />;
}

function Message({
  title,
  children,
  onLeave,
}: {
  title: string;
  children: React.ReactNode;
  onLeave: () => void;
}) {
  return (
    <>
      <h1>{title}</h1>
      <p>{children}</p>
      <button className="btn ghost" onClick={onLeave}>
        トップに戻る
      </button>
    </>
  );
}

function GmLogin({
  code,
  reason,
  onLeave,
}: {
  code: string;
  reason: string | null;
  onLeave: () => void;
}) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ack = await net.call("gm:login", { code, pass });
    if (!ack.ok) return setError(ack.message);
    const session = { kind: "gm" as const, code, token: String(ack.gmToken) };
    storage.remember(session);
    net.start(session, false);
  };
  return (
    <>
      <h1>GMとして入る（部屋 {code}）</h1>
      {reason && <p className="muted">{reason}</p>}
      <form onSubmit={(e) => void submit(e)}>
        <div className="row">
          <input
            type="password"
            placeholder="GM合言葉"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
          />
          <button className="btn" type="submit">
            入る
          </button>
        </div>
        <ErrorText message={error} />
      </form>
      <button className="btn ghost" onClick={onLeave}>
        トップに戻る
      </button>
    </>
  );
}

function GmRoom({ view }: { view: GMView }) {
  const st = useNet();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = playerUrl(view.code);
  const idx = PHASES.indexOf(view.phase);
  const scripts = script(view.settings, view.redrawLimit || 2);

  const act = async (event: string, payload: unknown = {}) => {
    setBusy(true);
    setError(null);
    const ack = await net.call(event, payload);
    setBusy(false);
    if (!ack.ok) setError(ack.message);
  };

  const next = () => {
    if (view.phase === "review") return void act("gm:nextSet");
    if (view.phase === "card") {
      const left = view.teams.filter((t) => !t.confirmed).length;
      if (
        left &&
        !window.confirm(
          `まだ確定していないチームが${left}つあります。表示中のカードで確定して、調査フェーズへ進みますか？`,
        )
      )
        return;
    }
    if (view.phase === "lobby" && view.unassigned.length) {
      if (
        !window.confirm(
          `チームを選んでいない人が${view.unassigned.length}人います。カードを配りますか？`,
        )
      )
        return;
    }
    void act("gm:setPhase", { to: PHASES[idx + 1] });
  };
  const back = () => {
    const to = PHASES[idx - 1];
    if (!to) return;
    const msg =
      view.phase === "card"
        ? "集合に戻すと、配ったカードを取り消します（引き直し・確定も取り消し）。戻しますか？"
        : `「${PHASE_LABELS[to]}」に戻しますか？（確定したカードは変わりません）`;
    if (window.confirm(msg)) void act("gm:setPhase", { to });
  };

  return (
    <>
      <div className="gmbar">
        <Steps now={view.phase} />
        <div className="row tight">
          <span>
            部屋 <b className="roomcode">{view.code}</b>　セット{view.setNo}
            　いま：<b>{PHASE_LABELS[view.phase]}</b>
          </span>
          <span className="grow" />
          <button
            className="btn ghost small"
            disabled={busy || idx === 0}
            onClick={back}
          >
            1つ戻る
          </button>
          <button
            className="btn go"
            disabled={busy || st.status !== "connected"}
            onClick={next}
          >
            {NEXT_LABEL[view.phase]}
          </button>
        </div>
        <ErrorText message={error} />
        {st.status !== "connected" && (
          <p className="err">
            サーバーにつながっていません。つなぎ直しています…
          </p>
        )}
      </div>

      <h1>GM画面</h1>
      <p className="lead">{settingsSummary(view.settings)}</p>
      {view.settings.gmPlays && (
        <div className="note">
          GMも参加するので、この画面では解決編まで答え（カード・場面・目的）を伏せています。GMは下の「参加者画面を開く」から自分のチームに参加してください。
        </div>
      )}

      <h2>台本：{PHASE_LABELS[view.phase]}</h2>
      {scripts[view.phase].map((s) => (
        <div className="panel now-script" key={s.title}>
          <h3 style={{ marginTop: 0 }}>{s.title}</h3>
          <p style={{ margin: 0 }}>{s.text}</p>
        </div>
      ))}

      <h2>チームの状況</h2>
      <Teams
        view={view}
        onMove={(memberId, team) =>
          void act("gm:moveMember", { memberId, team })
        }
      />

      <h2>参加者に配るURL</h2>
      <div className="panel">
        <div className="url">{url}</div>
        <div className="row">
          <CopyButton text={url} label="URLをコピー" />
          <a
            className="btn small ghost"
            href={url}
            target="_blank"
            rel="noopener"
          >
            参加者画面を開く
          </a>
        </div>
        <Qr text={url} />
      </div>

      {(view.phase === "lobby" || view.phase === "review") && (
        <SettingsPanel view={view} />
      )}

      <details>
        <summary>すべてのフェーズの台本</summary>
        {PHASES.flatMap((p) => scripts[p]).map((s) => (
          <div key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </details>

      <h2>配点</h2>
      <Score />

      <h2>出来事の記録</h2>
      <ul className="log">
        {[...view.log].reverse().map((l, i) => (
          <li key={i}>
            <span className="muted">
              {new Date(l.at).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>{" "}
            {l.text}
          </li>
        ))}
      </ul>
    </>
  );
}

function Teams({
  view,
  onMove,
}: {
  view: GMView;
  onMove: (memberId: string, team: string | null) => void;
}) {
  const teamIds = view.teams.map((t) => t.id);
  const dealt = view.phase !== "lobby";
  return (
    <>
      <div className="scroll">
        <table>
          <tbody>
            <tr>
              <th>チーム</th>
              <th>メンバー</th>
              <th>カード</th>
              <th>状況</th>
            </tr>
            {view.teams.map((t) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>
                  {t.members.length ? (
                    t.members.map((m) => (
                      <MemberChip
                        key={m.id}
                        m={m}
                        team={t.id}
                        teamIds={teamIds}
                        onMove={onMove}
                      />
                    ))
                  ) : (
                    <span className="muted">（まだいません）</span>
                  )}
                </td>
                <td>
                  <TeamCard t={t} dealt={dealt} />
                </td>
                <td>{dealt ? status(t, view.redrawLimit) : "―"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.unassigned.length > 0 && (
        <p>
          チームを選んでいない人：
          {view.unassigned.map((m) => (
            <MemberChip
              key={m.id}
              m={m}
              team={null}
              teamIds={teamIds}
              onMove={onMove}
            />
          ))}
        </p>
      )}
    </>
  );
}

function status(t: TeamView, limit: number): string {
  if (t.confirmed)
    return t.confirmedBy ? `確定（${t.confirmedBy}さん）` : "確定（自動）";
  return limit ? `未確定（引き直し ${t.redrawsUsed}／${limit}）` : "未確定";
}

function TeamCard({ t, dealt }: { t: TeamView; dealt: boolean }) {
  if (!dealt) return <span className="muted">―</span>;
  if (!t.card) return <span className="muted">（伏せています）</span>;
  return (
    <>
      <b>
        {t.card.id} {t.card.stars}
      </b>{" "}
      {t.card.scene}
      <br />
      <span className="muted">{t.card.purpose}</span>
    </>
  );
}

function MemberChip({
  m,
  team,
  teamIds,
  onMove,
}: {
  m: MemberSummary;
  team: string | null;
  teamIds: string[];
  onMove: (memberId: string, team: string | null) => void;
}) {
  return (
    <span className="chip">
      <span
        className={m.connected ? "dot on" : "dot off"}
        title={m.connected ? "接続中" : "未接続"}
      />
      {m.nickname}
      <select
        aria-label={`${m.nickname}さんを移す`}
        value={team ?? ""}
        onChange={(e) => m.id && onMove(m.id, e.target.value || null)}
      >
        <option value="">未選択</option>
        {teamIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </span>
  );
}

function SettingsPanel({ view }: { view: GMView }) {
  const [draft, setDraft] = useState<Settings>(view.nextSettings);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(view.nextSettings);
  const save = async () => {
    setError(null);
    const ack = await net.call("gm:updateSettings", { settings: draft });
    if (!ack.ok) return setError(ack.message);
    setMsg("設定を変えました。");
  };
  return (
    <>
      <h2>設定</h2>
      {view.phase === "review" && (
        <p className="muted">ここで変えた設定は、次のセットから使います。</p>
      )}
      <SettingsForm
        value={draft}
        onChange={(s) => {
          setDraft(s);
          setMsg(null);
        }}
      />
      <div className="row">
        <button className="btn" disabled={!changed} onClick={() => void save()}>
          設定を保存
        </button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      <ErrorText message={error} />
    </>
  );
}
