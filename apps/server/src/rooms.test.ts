import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  ROOM_TTL_MS,
  createRoom,
  join as joinRoom,
  mulberry32,
  type Room,
} from "@mdt/core";
import { loadCardsets } from "./cardsets.js";
import { MAX_ROOMS, RoomManager } from "./rooms.js";
import {
  hashPasswordSync,
  hashToken,
  newToken,
  verifyPassword,
} from "./secrets.js";
import { FileStore, MemoryStore } from "./store.js";

const cardsDir = fileURLToPath(new URL("../../../data/cards", import.meta.url));
const cardsets = loadCardsets(cardsDir, "v0.4");

function roomOf(code: string, now: number, cardset = "v0.4"): Room {
  const r = createRoom({
    code,
    gmTokenHash: "h",
    settings: DEFAULT_SETTINGS,
    cardset,
    now,
  });
  if (!r.ok) throw new Error(r.message);
  const j = joinRoom(
    r.room,
    { id: "m1", tokenHash: "t", nickname: "佐藤" },
    now,
  );
  if (!j.ok) throw new Error(j.message);
  return j.room;
}

function manager(store = new MemoryStore(), clock = { t: 1_000_000 }) {
  const changed: string[] = [];
  const closed: string[] = [];
  const m = new RoomManager({
    store,
    cardsets,
    now: () => clock.t,
    rand: mulberry32(1),
    onChange: (c) => changed.push(c),
    onClosed: (c) => closed.push(c),
    saveDelayMs: 20,
  });
  return { m, store, clock, changed, closed };
}

describe("部屋の置き場", () => {
  it("変化をまとめて保存する（1秒以内に1回）", async () => {
    const { m, store } = manager();
    for (let i = 0; i < 5; i++) m.add(roomOf(`AAAAA${i}`, 1_000_000));
    expect(store.saves).toBe(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(store.saves).toBe(1);
    expect(JSON.parse(store.data!)).toHaveLength(5);
  });

  it("読み戻すとき、期限切れ・カード集のない部屋は捨て、全員を未接続にする", async () => {
    const store = new MemoryStore();
    const t = 10 * ROOM_TTL_MS;
    store.data = JSON.stringify([
      roomOf("AAAAAA", t),
      roomOf("CCCCCC", t - ROOM_TTL_MS),
      roomOf("DDDDDD", t, "v9"),
    ]);
    const { m } = manager(store, { t });
    await m.init();
    expect(m.size).toBe(1);
    expect(m.get("AAAAAA")?.members[0]?.connected).toBe(false);
  });

  it(`部屋数の上限は ${MAX_ROOMS}`, () => {
    const { m } = manager();
    for (let i = 0; i < MAX_ROOMS; i++) m.add(roomOf(m.newCode(), 1_000_000));
    expect(m.isFull()).toBe(true);
  });

  it("期限切れの部屋を消して知らせる", () => {
    const { m, clock, closed } = manager();
    m.add(roomOf("AAAAAA", clock.t));
    clock.t += ROOM_TTL_MS - 1;
    m.sweep();
    expect(closed).toEqual([]);
    clock.t += 1;
    m.sweep();
    expect(closed).toEqual(["AAAAAA"]);
    expect(m.size).toBe(0);
  });
});

describe("ファイルへの保存", () => {
  it("一時ファイルに書いてから置き換え、読み戻せる", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdt-"));
    const file = join(dir, "sub", "rooms.json");
    const store = new FileStore(file);
    expect(await store.load()).toEqual([]);
    const rooms = [roomOf("AAAAAA", 1)];
    await store.save(rooms);
    expect(await store.load()).toEqual(rooms);
    expect(readdirSync(join(dir, "sub"))).toEqual(["rooms.json"]);
    expect(JSON.parse(readFileSync(file, "utf8")).format).toBe(1);
  });
});

describe("合言葉とトークン", () => {
  it("ハッシュで比べる。合言葉そのものはハッシュに入らない", async () => {
    const h = hashPasswordSync("ルーペ");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(h).not.toContain("ルーペ");
    expect(await verifyPassword("ルーペ", h)).toBe(true);
    expect(await verifyPassword("ルーペ ", h)).toBe(true);
    expect(await verifyPassword("ワトソン", h)).toBe(false);
    expect(await verifyPassword(undefined, h)).toBe(false);
    expect(await verifyPassword("ルーペ", "壊れた形式")).toBe(false);
  });
  it("トークンは毎回ちがい、ハッシュは同じトークンなら同じ", () => {
    const a = newToken();
    expect(a).not.toBe(newToken());
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toContain(a);
  });
});

describe("カード集の読み込み", () => {
  it("既定の版がなければ起動しない", () => {
    expect(() => loadCardsets(cardsDir, "v9.9")).toThrow("v9.9");
  });
});
