/** 参加者の画面：参加 → チーム選択 → カード提示〜振り返り */
import { useEffect, useState, type FormEvent } from "react";
import { PHASES, opponentOf, type MemberView, type TeamView } from "@mdt/core";
import { net, useNet } from "./net";
import {
  BalusBox,
  BoundView,
  CardView,
  CopyButton,
  ErrorText,
  Kikikomi,
  ReviewPoints,
  Rules,
  Score,
  Steps,
  TIMER_NOTE,
  answerTemplate,
} from "./parts";
import { storage } from "./storage";

export function Member({ code }: { code: string }) {
  const st = useNet();
  const view =
    st.view?.role === "member" && st.view.code === code ? st.view : null;

  useEffect(() => {
    const token = storage.token("member", code);
    if (token && !net.isCurrent("member", code))
      net.start({ kind: "member", code, token }, true);
  }, [code]);

  if (st.notice === "closed") {
    return (
      <>
        <h1>部屋が閉じられました</h1>
        <p>
          この部屋は使えなくなりました。ゲームマスターに新しいURLをもらってください。
        </p>
      </>
    );
  }
  if (!view && (st.resumeError || !storage.token("member", code))) {
    return <Join code={code} reason={st.resumeError} />;
  }
  if (!view) return <p className="loading">読み込み中…</p>;
  return <Play view={view} />;
}

function Join({
  code,
  reason,
}: {
  code: string;
  reason: { code: string; message: string } | null;
}) {
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (reason?.code === "room_not_found") {
    return (
      <>
        <h1>部屋が見つかりません</h1>
        <p>
          URLが正しいか、ゲームマスターに確かめてください。部屋は最後の操作から48時間で消えます。
        </p>
      </>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ack = await net.call("member:join", { code, nickname });
    setBusy(false);
    if (!ack.ok) return setError(ack.message);
    const session = {
      kind: "member" as const,
      code,
      token: String(ack.memberToken),
    };
    storage.remember(session);
    net.start(session, false);
  };
  return (
    <>
      <h1>モデル探偵に参加する</h1>
      <p className="lead">
        部屋 {code} に参加します。ほかの人に見えるニックネームを入れてください。
      </p>
      {reason && <p className="muted">{reason.message}</p>}
      <form onSubmit={(e) => void submit(e)}>
        <div className="row">
          <input
            type="text"
            placeholder="ニックネーム"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoFocus
            required
          />
          <button className="btn go" type="submit" disabled={busy}>
            参加する
          </button>
        </div>
        <ErrorText message={error} />
      </form>
    </>
  );
}

const teamName = (id: string) => {
  const [g, side] = id.split("-");
  return `${g}・${side}チーム`;
};

function Play({ view }: { view: MemberView }) {
  const st = useNet();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const myId = view.me.team;
  const mine = view.teams.find((t) => t.id === myId) ?? null;
  const opp = myId
    ? (view.teams.find((t) => t.id === opponentOf(myId)) ?? null)
    : null;

  // フェーズが変わったら上に戻す
  useEffect(() => window.scrollTo(0, 0), [view.phase, view.setNo]);

  const act = async (event: string, payload: unknown) => {
    setError(null);
    const ack = await net.call(event, payload);
    if (!ack.ok) setError(ack.message);
    return ack.ok;
  };

  const choose = async (team: string | null) => {
    if (myId && PHASES.indexOf(view.phase) >= PHASES.indexOf("investigate")) {
      if (
        !window.confirm(
          "チームを変えると、見えるカードが変わります。変えますか？",
        )
      )
        return;
    }
    if (await act("member:chooseTeam", { team })) setChoosing(false);
  };

  return (
    <>
      <Steps now={view.phase} />
      <div className="whoami">
        <span>
          <b>{view.me.nickname}</b> さん
          {mine && (
            <>
              ｜{teamName(mine.id)}（
              {mine.members.map((m) => m.nickname).join("・")}）
            </>
          )}
        </span>
        <span className={st.status === "connected" ? "conn on" : "conn off"}>
          {st.status === "connected" ? "接続中" : "つなぎ直しています…"}
        </span>
      </div>
      <ErrorText message={error} />

      {!mine || choosing ? (
        <TeamSelect
          view={view}
          onChoose={(t) => void choose(t)}
          onCancel={mine ? () => setChoosing(false) : null}
        />
      ) : (
        <>
          <Phase view={view} mine={mine} opp={opp} act={act} />
          <details>
            <summary>チームを変える</summary>
            <p className="muted">
              まちがえて選んだときや、ゲームマスターに言われたときに変えてください。
            </p>
            <button
              className="btn small ghost"
              onClick={() => setChoosing(true)}
            >
              チームを選び直す
            </button>
          </details>
        </>
      )}
    </>
  );
}

function TeamSelect({
  view,
  onChoose,
  onCancel,
}: {
  view: MemberView;
  onChoose: (team: string) => void;
  onCancel: (() => void) | null;
}) {
  const groups = Array.from({ length: view.groups }, (_, i) => i + 1);
  return (
    <>
      <h1>チームを選ぶ</h1>
      <p className="lead">
        {view.settings.mode === "kikikomi"
          ? "聞き込みモード"
          : "シナリオモード"}
        のゲームです。ゲームマスターの案内に従って、自分のグループとチームを選んでください。
      </p>
      <div className="teamgrid">
        {groups.map((g) => (
          <div className="panel" key={g}>
            <h3 style={{ marginTop: 0 }}>グループ G{g}</h3>
            <div className="row">
              {(["A", "B"] as const).map((side) => {
                const t = view.teams.find((x) => x.id === `G${g}-${side}`);
                const n = t?.members.length ?? 0;
                return (
                  <button
                    key={side}
                    className={view.me.team === t?.id ? "btn" : "btn ghost"}
                    onClick={() => t && onChoose(t.id)}
                  >
                    {side}チーム（{n}人）
                    {n > 0 && (
                      <small className="names">
                        {t?.members.map((m) => m.nickname).join("・")}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="note">
        同じチームの人どうしで、同じグループ・同じチームを選んでください。
      </div>
      {onCancel && (
        <button className="btn ghost" onClick={onCancel}>
          やめる
        </button>
      )}
    </>
  );
}

type Act = (event: string, payload: unknown) => Promise<boolean>;

function Phase({
  view,
  mine,
  opp,
  act,
}: {
  view: MemberView;
  mine: TeamView;
  opp: TeamView | null;
  act: Act;
}) {
  const s = view.settings;
  const kik = s.mode === "kikikomi";
  const name = teamName(mine.id);
  const oppSide = mine.side === "A" ? "B" : "A";
  const waitNext = (
    <p className="muted">次のフェーズへは、ゲームマスターが進めます。</p>
  );

  switch (view.phase) {
    case "lobby":
      return (
        <>
          <h1>集合（{name}）</h1>
          <div className="panel">
            <p style={{ margin: 0 }}>
              <b>ゲームマスターの開始を待っています。</b>
              カードが配られると、この画面が切り替わります。
            </p>
          </div>
        </>
      );

    case "card": {
      const card = mine.card;
      if (!card) return null;
      const left = view.redrawLimit - mine.redrawsUsed;
      const req = { setNo: view.setNo, cardId: card.id };
      return (
        <>
          <h1>テーマカード（{name}）</h1>
          <p className="lead">
            チームで読んで、このカードでいくか決めてください。カードは相手チームに見せないでください。
          </p>
          <CardView card={card} />
          {mine.confirmed ? (
            <div className="note">
              <b>このカードで確定しました</b>
              {mine.confirmedBy ? `（${mine.confirmedBy}さん）` : ""}
              。ゲームマスターが調査フェーズへ進めるのを待っています。
            </div>
          ) : (
            <>
              {s.dist === "common" ? (
                <p className="muted">
                  共通カード方式なので、カードの引き直しはできません。
                </p>
              ) : (
                <p className="muted">
                  引き直しは、あと <b>{left}</b>{" "}
                  回できます。引き直すと、前のカードには戻れません。チームの誰が押しても、チーム全員の画面が変わります。
                </p>
              )}
              <div className="row">
                {s.dist === "individual" && (
                  <button
                    className="btn ghost"
                    disabled={left <= 0}
                    onClick={() => {
                      if (
                        window.confirm(
                          "カードを引き直しますか？前のカードには戻れません。",
                        )
                      )
                        void act("team:redraw", req);
                    }}
                  >
                    引き直す
                  </button>
                )}
                <button
                  className="btn go"
                  onClick={() => void act("team:confirm", req)}
                >
                  これでいく
                </button>
              </div>
            </>
          )}
        </>
      );
    }

    case "investigate":
      return (
        <>
          <h1>調査フェーズ（{name}）</h1>
          <BalusBox
            items={[
              ...(kik
                ? [
                    <>
                      <b>聞き込み対象の人に話を聞きながら</b>、同時に Balus
                      でモデリングしてください（下の「聞き込みの進め方」）。
                    </>,
                  ]
                : []),
              <b>
                Balus
                上でモデリングしながら、このお題について話し合ってください。
              </b>,
              "結論は、モデルとは別の場所に書いてください（場所はゲームマスターの案内に従ってください）。",
              "モデルには、場面の言葉、目的の文、お題の問い、結論を書かないでください。",
              TIMER_NOTE,
            ]}
          />
          {mine.card && <CardView card={mine.card} />}
          {kik && (
            <>
              <h2>聞き込みの進め方</h2>
              <Kikikomi />
            </>
          )}
          <h2>モデリングのルール</h2>
          <Rules />
          <h2>結論の書き方</h2>
          <ul>
            <li>お題の問いに、1〜3文で直接答えます。</li>
            <li>締め切りは、ゲームマスターが推理フェーズへ進めた時点です。</li>
          </ul>
          {waitNext}
        </>
      );

    case "deduce": {
      const tmpl = answerTemplate(mine.id, s.purposeChoice);
      return (
        <>
          <h1>推理フェーズ（{name}）</h1>
          <BalusBox
            items={[
              <>
                <b>
                  Balus で相手チーム（{oppSide}
                  チーム）のモデルを開いて、読み取ってください。
                </b>
                モデルは見るだけで、編集しないでください。
              </>,
              "回答（場面・目的・結論）は、下のひな形を使って、ゲームマスターが案内する場所に書いてください。その回答にした理由は書かず、解決編で発表するときに口頭で説明します。",
              "相手チームに質問してはいけません。モデルだけが手がかりです。",
              TIMER_NOTE,
            ]}
          />
          {s.purposeChoice ? (
            <>
              <h2>目的の選択肢（相手チームのカード）</h2>
              {opp?.options ? (
                <div className="panel">
                  <ol className="opts">
                    {opp.options.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="muted">相手チームのカードがまだありません。</p>
              )}
            </>
          ) : (
            <>
              <h2>目的</h2>
              <p>
                このモデルが何のために描かれたかを、1文で書いてください（選択肢はありません）。
              </p>
            </>
          )}
          <h2>場面の選択肢</h2>
          <div className="scenes">
            {(view.scenes ?? []).map((x) => (
              <div key={x}>{x}</div>
            ))}
          </div>
          <h2>回答のひな形</h2>
          <textarea readOnly value={tmpl} />
          <div className="row">
            <CopyButton text={tmpl} label="ひな形をコピー" />
          </div>
          {mine.card && (
            <details>
              <summary>自分のチームのカードを見る</summary>
              <CardView card={mine.card} />
            </details>
          )}
          {waitNext}
        </>
      );
    }

    case "reveal":
      return (
        <>
          <h1>解決編（{name}）</h1>
          <BalusBox
            items={[
              <b>
                Balus で両チームのモデルを開き、下の答えと見比べてください。
              </b>,
              "各チームの結論は、ゲームマスターが公開します。",
            ]}
          />
          <div className="reveal">
            <div className="side">
              <h3>相手チーム（{oppSide}）のカード ＝ あなたが推理したモデル</h3>
              {opp?.card ? (
                <CardView card={opp.card} memo note />
              ) : (
                <p className="muted">相手チームのカードがありません。</p>
              )}
              <BoundView bound={opp?.bound} />
            </div>
            <div className="side">
              <h3>自分のチーム（{mine.side}）のカード</h3>
              {mine.card && <CardView card={mine.card} memo note />}
              <BoundView bound={mine.bound} />
            </div>
          </div>
          <h2>配点</h2>
          <Score />
          {waitNext}
        </>
      );

    case "review":
      return (
        <>
          <h1>振り返り</h1>
          <BalusBox
            items={[
              <>
                <b>ゲームマスターが画面共有する Balus のモデルを見ながら</b>
                、話し合いましょう。
              </>,
            ]}
          />
          <h2>話し合いの切り口</h2>
          <ReviewPoints settings={s} />
          <h2>全グループのカード</h2>
          <AllCards teams={view.teams} myId={mine.id} />
          <details>
            <summary>自分と相手のカードをもう一度見る</summary>
            {mine.card && <CardView card={mine.card} memo />}
            {opp?.card && <CardView card={opp.card} memo />}
          </details>
          <p className="muted">
            次のセットは、ゲームマスターが始めます（チーム分けはそのままです）。
          </p>
        </>
      );
  }
}

function AllCards({ teams, myId }: { teams: TeamView[]; myId: string }) {
  return (
    <div className="scroll">
      <table>
        <tbody>
          <tr>
            <th>チーム</th>
            <th>カード</th>
            <th>場面</th>
            <th>目的</th>
            <th>メンバー</th>
          </tr>
          {teams.map((t) => (
            <tr key={t.id} className={t.id === myId ? "me" : ""}>
              <td>{t.id}</td>
              <td>{t.card ? `${t.card.id} ${t.card.stars}` : "―"}</td>
              <td>{t.card?.scene ?? "―"}</td>
              <td>{t.card?.purpose ?? "―"}</td>
              <td>{t.members.map((m) => m.nickname).join("・")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
