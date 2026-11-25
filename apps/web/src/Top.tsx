/** トップ（GM用）：部屋を作る／GMとして入り直す */
import { useState, type FormEvent } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@mdt/core";
import { net } from "./net";
import { ErrorText } from "./parts";
import { SettingsForm } from "./SettingsForm";
import { storage } from "./storage";

export function Top({ onEnterGm }: { onEnterGm: (code: string) => void }) {
  const [pass, setPass] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pass2, setPass2] = useState("");
  const [error2, setError2] = useState<string | null>(null);
  const last = storage.lastGmRoom();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ack = await net.call("gm:create", { pass, settings });
    setBusy(false);
    if (!ack.ok) return setError(ack.message);
    const session = {
      kind: "gm" as const,
      code: String(ack.code),
      token: String(ack.gmToken),
    };
    storage.remember(session);
    net.start(session, false);
    onEnterGm(session.code);
  };

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setError2(null);
    const c = code.trim().toUpperCase();
    const ack = await net.call("gm:login", { code: c, pass: pass2 });
    if (!ack.ok) return setError2(ack.message);
    const session = {
      kind: "gm" as const,
      code: c,
      token: String(ack.gmToken),
    };
    storage.remember(session);
    net.start(session, false);
    onEnterGm(c);
  };

  return (
    <>
      <h1>ゲームをはじめる（ゲームマスター用）</h1>
      <p className="lead">
        参加者の方は、ゲームマスターから配られたURLを開いてください。
      </p>

      {last && storage.token("gm", last) && (
        <div className="note">
          前に作った部屋（{last}）があります。{" "}
          <button
            type="button"
            className="btn small ghost"
            onClick={() => onEnterGm(last)}
          >
            GM画面に戻る
          </button>
        </div>
      )}

      <form onSubmit={(e) => void create(e)}>
        <fieldset>
          <legend>GM合言葉</legend>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
            required
          />
        </fieldset>
        <SettingsForm value={settings} onChange={setSettings} />
        <ErrorText message={error} />
        <div className="row">
          <button className="btn go" type="submit" disabled={busy}>
            部屋を作る
          </button>
        </div>
      </form>

      <details>
        <summary>作った部屋に、GMとして入り直す（別の端末から）</summary>
        <form onSubmit={(e) => void login(e)}>
          <div className="row">
            <input
              type="text"
              className="code"
              placeholder="部屋コード"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="GM合言葉"
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              required
            />
            <button className="btn" type="submit">
              入り直す
            </button>
          </div>
          <p className="muted">入り直すと、前の端末のGM画面は止まります。</p>
          <ErrorText message={error2} />
        </form>
      </details>

      <details>
        <summary>このアプリについて</summary>
        <p>
          モデル探偵（仮称）の進行を案内するアプリです。モデリングとタイマーは
          Balus で、回答の記入と採点は Balus
          や画面の外で行います。アプリは、カードの提示と、フェーズの案内・公開だけを行います。
        </p>
        <p>
          GMがフェーズを進めると、参加者全員の画面が同時に切り替わります。チームが確定したカードは、相手チームとGMの画面に必要なときだけ自動で表示されます。
        </p>
      </details>
    </>
  );
}
