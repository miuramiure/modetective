/**
 * トークンをブラウザに保存する（部屋ごと）。閉じても同じチームに戻れるようにするため。
 * 1つのブラウザで何人分も試すときは、URL に &slot=2 などを付けると別の人として保存する（開発・試験用）。
 */
import type { Session } from "./net";

const slot = (): string => {
  const s = new URLSearchParams(location.search).get("slot");
  return s && /^\w{1,10}$/.test(s) ? `:${s}` : "";
};
const key = (kind: "gm" | "member", code: string) =>
  `modetective:${kind}:${code}${slot()}`;

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function put(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // 覚えられなくても動く（閉じると入り直しになる）
  }
}

export const storage = {
  token: (kind: "gm" | "member", code: string): string | null =>
    get(key(kind, code)),
  remember: (s: Session): void => {
    put(key(s.kind, s.code), s.token);
    if (s.kind === "gm") put("modetective:lastGm", s.code);
  },
  forget: (s: Pick<Session, "kind" | "code">): void =>
    put(key(s.kind, s.code), null),
  lastGmRoom: (): string | null => get("modetective:lastGm"),
};
