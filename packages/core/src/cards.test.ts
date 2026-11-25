import { describe, expect, it } from "vitest";
import { CardsetError, boundOf, loadCardset, parseCards } from "./cards.js";
import { loadV1, readCardText, v04 } from "./test/helpers.js";

describe("カード集 v0.4 の読み込み", () => {
  const cs = v04();
  const cards = Object.values(cs.cards);

  it("シナリオ28枚・聞き込み20枚、場面リスト56／40個が読める", () => {
    expect(cards.filter((c) => c.mode === "T")).toHaveLength(28);
    expect(cards.filter((c) => c.mode === "K")).toHaveLength(20);
    expect(cs.scenes.T).toHaveLength(56);
    expect(cs.scenes.K).toHaveLength(40);
  });

  it("カードの項目が読める（T01・K01）", () => {
    expect(cs.cards.T01).toMatchObject({
      id: "T01",
      mode: "T",
      stars: "★",
      kind: "",
      scene: "カレーづくり",
      purpose: "買い出しの中身を決める",
      form: "買うものの列挙",
    });
    expect(cs.cards.T01?.odai).toContain("**スーパーで何を買えばよいか？**");
    expect(cs.cards.T01?.options).toHaveLength(5);
    expect(cs.cards.K01).toMatchObject({ mode: "K", stars: "★", kind: "日常系" });
    expect(cs.cards.K01?.note).toContain("通勤");
  });

  it("判定の境界が読める（シナリオ19行・聞き込み20行）", () => {
    const b = Object.values(cs.bounds);
    expect(b.filter((x) => x.mode === "T")).toHaveLength(19);
    expect(b.filter((x) => x.mode === "K")).toHaveLength(20);
    expect(boundOf(cs, cs.cards.T01!)).toMatchObject({ scene: "カレーづくり" });
    expect(boundOf(cs, cs.cards.T01!)?.near).toContain("料理教室");
    // 「朝の支度（K01）」の括弧は取る
    expect(cs.bounds["K:朝の支度"]?.near).toContain("通勤");
  });

  it("v1 の parseCards と同じ結果になる", () => {
    const v1 = loadV1();
    const text = readCardText();
    const got = v1.run(`
      const d = parseCards(${JSON.stringify(text)});
      const cards = {};
      for (const [id, c] of Object.entries(d.cards)) {
        cards[id] = { id: c.id, mode: c.mode, stars: c.stars, kind: c.kind, scene: c.scene, purpose: c.purpose,
          odai: c.odai, form: c.form, memo: c.memo, options: c.options, note: c.note };
      }
      const bounds = {};
      for (const [k, b] of Object.entries(d.bounds)) {
        bounds[k] = { mode: k[0], scene: b.scene, near: [...b.near], near1: b.near1, near2: b.near2, text: b.text };
      }
      return { cards, scenes: d.scenes, bounds };
    `);
    const mine = parseCards(text);
    expect({ cards: mine.cards, scenes: mine.scenes, bounds: mine.bounds }).toEqual(got);
  });
});

describe("カード集の検証（おかしければ起動しない）", () => {
  const text = readCardText();
  const problemsOf = (t: string): string[] => {
    try {
      loadCardset(t, "test");
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(CardsetError);
      return (e as CardsetError).problems;
    }
  };

  it("v0.4 は問題なし", () => {
    expect(problemsOf(text)).toEqual([]);
  });

  it("場面が場面リストにない", () => {
    const t = text.replace("- **場面**：カレーづくり", "- **場面**：カレーの仕込み");
    expect(problemsOf(t)).toContainEqual(expect.stringContaining("T01：場面「カレーの仕込み」"));
  });

  it("目的の選択肢に正解がない", () => {
    const t = text.replace("買い物にかかる時間を見積もる／買い出しの中身を決める／", "買い物にかかる時間を見積もる／");
    expect(problemsOf(t)).toContainEqual(expect.stringContaining("T01：目的の選択肢に正解"));
  });

  it("項目が欠けている", () => {
    const t = text.replace("- **結論の形**：買うものの列挙\n", "");
    expect(problemsOf(t)).toContainEqual("T01：「結論の形」がありません");
  });

  it("対応表の場面が場面リストにない", () => {
    const t = text.replace("| カレーづくり | 弁当づくり、", "| カレー作り | 弁当づくり、");
    expect(problemsOf(t)).toContainEqual(expect.stringContaining("「カレー作り」が場面の選択肢リストにありません"));
  });

  it("カード番号が重なっている", () => {
    const t = text.replace("## T02　★★", "## T01　★★");
    expect(problemsOf(t)).toContainEqual("カード番号 T01 が重なっています");
  });

  it("カードがない", () => {
    expect(problemsOf("# 空のカード集\n")).toContain("カードが1枚もありません");
  });

  it("CRLF の改行でも同じに読める", () => {
    const crlf = loadCardset(text.replace(/\n/g, "\r\n"), "v0.4");
    expect(crlf.cards).toEqual(v04().cards);
  });
});
