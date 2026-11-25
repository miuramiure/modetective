import { describe, expect, it } from "vitest";
import type { Cardset } from "./cards.js";
import {
  DEFAULT_SETTINGS,
  DealError,
  MAX_GROUPS,
  REDRAW_LIMIT,
  checkSettings,
  conflicts,
  deal,
  mulberry32,
  type Settings,
} from "./deal.js";
import { loadV1, readCardText, v04 } from "./test/helpers.js";

const cs = v04();
const S = (s: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...s });

describe("組み合わせ禁止", () => {
  const C = (id: string) => cs.cards[id]!;
  it("同じカード・同じ場面", () => {
    expect(conflicts(cs, C("T01"), C("T01"))).toBe(true);
    // T09・T10・T11 は同じ場面（T11 の補足）
    expect(C("T09").scene).toBe(C("T10").scene);
    expect(conflicts(cs, C("T09"), C("T10"))).toBe(true);
  });
  it("対応表の同じ行に入る場面（どちら向きでも）", () => {
    const curry = Object.values(cs.cards).find((c) => c.scene === "カレーづくり")!;
    const fake = { ...curry, id: "T99", scene: "料理教室", note: "" };
    expect(conflicts(cs, curry, fake)).toBe(true);
    expect(conflicts(cs, fake, curry)).toBe(true);
  });
  it("補足に書かれた組み合わせ", () => {
    // K02 の補足：K10 と組み合わせない
    expect(C("K02").note).toContain("K10");
    expect(conflicts(cs, C("K02"), C("K10"))).toBe(true);
    expect(conflicts(cs, C("K10"), C("K02"))).toBe(true);
  });
  it("関係のないカードは組み合わせてよい", () => {
    const ok = Object.values(cs.cards).filter((c) => c.mode === "T" && !conflicts(cs, C("T01"), c));
    expect(ok.length).toBeGreaterThan(10);
  });
});

describe("配布", () => {
  const combos: Settings[] = [];
  for (const dist of ["individual", "common"] as const)
    for (const mode of ["scenario", "kikikomi"] as const)
      for (const groups of [1, 3, MAX_GROUPS]) combos.push(S({ dist, mode, groups }));

  it.each(combos)("%o：山のどの組み合わせも組み合わせ禁止にならない", (s) => {
    for (let seed = 1; seed <= 30; seed++) {
      const decks = deal(cs, s, mulberry32(seed));
      expect(decks).toHaveLength(s.dist === "common" ? 1 : s.groups);
      const size = s.dist === "common" ? 1 : 1 + REDRAW_LIMIT;
      const prefix = s.mode === "scenario" ? "T" : "K";
      for (const d of decks) {
        expect(d.A).toHaveLength(size);
        expect(d.B).toHaveLength(size);
        expect(new Set([...d.A, ...d.B]).size).toBe(size * 2);
        for (const id of [...d.A, ...d.B]) expect(id[0]).toBe(prefix);
        for (const a of d.A) for (const b of d.B) expect(conflicts(cs, cs.cards[a]!, cs.cards[b]!)).toBe(false);
      }
    }
  });

  it("同じ乱数なら同じ配り方になる", () => {
    const s = S({ groups: 4 });
    expect(deal(cs, s, mulberry32(42))).toEqual(deal(cs, s, mulberry32(42)));
    expect(deal(cs, s, mulberry32(42))).not.toEqual(deal(cs, s, mulberry32(43)));
  });

  it("v1 の deal と同じ配り方になる（同じ乱数の種）", () => {
    const v1 = loadV1();
    v1.run(`DATA = parseCards(${JSON.stringify(readCardText())}); return null;`);
    for (const seed of [1, 7, 12345, 2 ** 31 - 1]) {
      for (const [mode, v1mode] of [
        ["scenario", "T"],
        ["kikikomi", "K"],
      ] as const) {
        for (const [dist, v1dist] of [
          ["individual", "indiv"],
          ["common", "common"],
        ] as const) {
          const want = v1.run(`return deal({ s: ${seed}, mode: "${v1mode}", dist: "${v1dist}", n: 5 });`);
          expect(deal(cs, S({ mode, dist, groups: 5 }), mulberry32(seed))).toEqual(want);
        }
      }
    }
  });

  it("カードが足りなければ DealError", () => {
    const one = structuredClone(cs) as Cardset;
    one.cards = { T01: cs.cards.T01! };
    expect(() => deal(one, S({}), mulberry32(1))).toThrow(DealError);
  });
});

describe("設定の確かめ", () => {
  it("正しい設定", () => {
    expect(checkSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(checkSettings(S({ groups: MAX_GROUPS }))).toBeNull();
  });
  it.each([
    null,
    "x",
    { ...DEFAULT_SETTINGS, dist: "indiv" },
    { ...DEFAULT_SETTINGS, mode: "T" },
    { ...DEFAULT_SETTINGS, purposeChoice: "yes" },
    { ...DEFAULT_SETTINGS, gmPlays: 1 },
    { ...DEFAULT_SETTINGS, groups: 0 },
    { ...DEFAULT_SETTINGS, groups: MAX_GROUPS + 1 },
    { ...DEFAULT_SETTINGS, groups: 1.5 },
  ])("おかしい設定：%o", (s) => {
    expect(checkSettings(s)).toEqual(expect.any(String));
  });
});
