/** テスト用の下準備（副作用あり：ファイルを読む） */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadCardset, type Cardset } from "../cards.js";
import { DEFAULT_SETTINGS, mulberry32, type Settings } from "../deal.js";
import { chooseTeam, createRoom, join, teamIds, type Result, type Room } from "../room.js";

const ROOT = new URL("../../../../", import.meta.url);

export function readCardText(version = "v0.4"): string {
  return readFileSync(new URL(`data/cards/${version}.md`, ROOT), "utf8");
}

let cached: Cardset | null = null;
export function v04(): Cardset {
  cached ??= loadCardset(readCardText("v0.4"), "v0.4");
  return cached;
}

/** v1 の app.js をそのまま読み込み、中の関数を呼べるようにする */
export function loadV1(): { run: (code: string) => unknown } {
  const code = readFileSync(new URL("docs/reference/v1/app.js", ROOT), "utf8");
  const ctx = vm.createContext({
    document: { getElementById: () => null },
    window: { addEventListener: () => undefined },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    location: { hash: "", href: "" },
    fetch: () => new Promise(() => undefined), // boot() を止めておく
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    console,
  });
  vm.runInContext(code, ctx);
  return {
    // 結果は JSON を通して、こちら側のオブジェクトにする
    run: (src: string) => {
      const out = vm.runInContext(`JSON.stringify((() => { ${src} })())`, ctx) as string | undefined;
      return out === undefined ? undefined : JSON.parse(out);
    },
  };
}

export function ok<T extends object>(r: Result<T>): Room {
  if (!r.ok) throw new Error(`操作が失敗しました：${r.code} ${r.message}`);
  return r.room;
}

export const rand = (seed = 1) => mulberry32(seed);

/** 部屋を作り、各チームに perTeam 人、未選択に unassigned 人を入れる */
export function roomWithMembers(
  settings: Partial<Settings> = {},
  opts: { perTeam?: number; unassigned?: number } = {},
): Room {
  const perTeam = opts.perTeam ?? 2;
  const unassigned = opts.unassigned ?? 1;
  let room: Room = ok(
    createRoom({
      code: "ACDEFG",
      gmTokenHash: "gm-hash",
      settings: { ...DEFAULT_SETTINGS, ...settings },
      cardset: "v0.4",
      now: 1000,
    }),
  );
  let n = 0;
  const add = (team: string | null) => {
    n += 1;
    room = ok(join(room, { id: `m${n}`, tokenHash: `token-hash-${n}`, nickname: `参加者${n}` }, 1000 + n));
    if (team) room = ok(chooseTeam(room, `m${n}`, team, 1000 + n));
  };
  for (const id of teamIds(room.settings.groups)) for (let i = 0; i < perTeam; i++) add(id);
  for (let i = 0; i < unassigned; i++) add(null);
  return room;
}

/** メンバー ID からチームの最初のメンバーを引く */
export function firstMemberOf(room: Room, team: string): string {
  const m = room.members.find((x) => x.team === team);
  if (!m) throw new Error(`${team} にメンバーがいません`);
  return m.id;
}
