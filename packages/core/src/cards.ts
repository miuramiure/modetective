/**
 * カード集（data/cards/<版>.md）の読み込みと検証。
 * 読み方は v1（docs/reference/v1/app.js の parseCards）を移植したもの。
 */

/** カードの種類。T＝シナリオモード、K＝聞き込みモード */
export type CardMode = "T" | "K";

export interface Card {
  id: string;
  mode: CardMode;
  stars: string;
  /** 聞き込みモードの系統（日常系・仕事系）。シナリオモードは空 */
  kind: string;
  scene: string;
  purpose: string;
  odai: string;
  form: string;
  memo: string;
  options: string[];
  note: string;
}

/** 判定の境界（第4部の対応表の1行） */
export interface Bound {
  mode: CardMode;
  scene: string;
  /** 題材が近い・形が似ている場面の名前（組み合わせ禁止の判定に使う） */
  near: string[];
  near1: string;
  near2: string;
  text: string;
}

export interface Cardset {
  version: string;
  cards: Record<string, Card>;
  scenes: Record<CardMode, string[]>;
  /** キーは `${mode}:${scene}` */
  bounds: Record<string, Bound>;
}

export class CardsetError extends Error {
  readonly problems: string[];
  constructor(version: string, problems: string[]) {
    super(`カード集 ${version} に問題があります：\n- ${problems.join("\n- ")}`);
    this.name = "CardsetError";
    this.problems = problems;
  }
}

const REQUIRED_FIELDS = [
  "場面",
  "目的",
  "お題",
  "結論の形",
  "目的の判定メモ",
  "目的の選択肢",
] as const;

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function tableAfter(lines: string[], startIdx: number): string[][] {
  const rows: string[][] = [];
  let i = startIdx;
  while (i < lines.length && !(lines[i] ?? "").trim().startsWith("|")) {
    if (/^#{1,3} /.test(lines[i] ?? "") && i > startIdx) return rows;
    i++;
  }
  for (; i < lines.length && (lines[i] ?? "").trim().startsWith("|"); i++) {
    rows.push(splitCells(lines[i] ?? ""));
  }
  return rows;
}

function namesIn(cell: string): string[] {
  return cell
    .replace(/（[^）]*）/g, "")
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "―" && s !== "-");
}

export interface ParsedCards {
  cards: Record<string, Card>;
  scenes: Record<CardMode, string[]>;
  bounds: Record<string, Bound>;
  /** 読み込み中に見つかった問題（重複したカード番号など） */
  problems: string[];
  /** カードごとの、mdに書かれていた項目名 */
  fieldsSeen: Record<string, string[]>;
}

/** md を読む（検証はしない）。v1 の parseCards と同じ結果になる */
export function parseCards(text: string): ParsedCards {
  const lines = text.split(/\r?\n/);
  const cards: Record<string, Card> = {};
  const fieldsSeen: Record<string, string[]> = {};
  const problems: string[] = [];
  const scenes: Record<CardMode, string[]> = { T: [], K: [] };
  const bounds: Record<string, Bound> = {};
  let cur: { id: string; f: Record<string, string> } | null = null;
  const raw: Record<string, { mode: CardMode; stars: string; kind: string; f: Record<string, string> }> =
    {};

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i] ?? "";
    const h = L.match(/^##\s+([TK]\d{2})\s+(★+)(?:\s+(\S+系))?/);
    if (h) {
      const id = h[1] ?? "";
      if (raw[id]) problems.push(`カード番号 ${id} が重なっています`);
      const entry = { mode: id[0] as CardMode, stars: h[2] ?? "", kind: h[3] ?? "", f: {} as Record<string, string> };
      raw[id] = entry;
      cur = { id, f: entry.f };
      continue;
    }
    if (/^#{1,2}\s/.test(L)) cur = null;
    if (cur) {
      const b = L.match(/^- \*\*(.+?)\*\*(?:（[^）]*）)?：(.*)$/);
      if (b) cur.f[b[1] ?? ""] = (b[2] ?? "").trim();
    }
    // 場面の選択肢リスト
    if (/^##\s+3-1/.test(L)) pushScenes(scenes.T, tableAfter(lines, i));
    if (/^##\s+3-2/.test(L)) pushScenes(scenes.K, tableAfter(lines, i));
    // 判定の境界
    if (/^##\s+4-[12]/.test(L)) {
      const mode: CardMode = /4-1/.test(L) ? "T" : "K";
      for (const r of tableAfter(lines, i).slice(2)) {
        if (r.length < 4) continue;
        const [c0 = "", c1 = "", c2 = "", c3 = ""] = r;
        const scene = c0.replace(/（[^）]*）/g, "").trim();
        const near = [...new Set([...namesIn(c1), ...namesIn(c2)])];
        bounds[`${mode}:${scene}`] = { mode, scene, near, near1: c1, near2: c2, text: c3 };
      }
    }
  }

  for (const [id, r] of Object.entries(raw)) {
    const f = r.f;
    fieldsSeen[id] = Object.keys(f);
    cards[id] = {
      id,
      mode: r.mode,
      stars: r.stars,
      kind: r.kind,
      scene: f["場面"] ?? "",
      purpose: f["目的"] ?? "",
      odai: f["お題"] ?? "",
      form: f["結論の形"] ?? "",
      memo: f["目的の判定メモ"] ?? "",
      options: (f["目的の選択肢"] ?? "")
        .split("／")
        .map((s) => s.trim())
        .filter(Boolean),
      note: f["補足"] ?? "",
    };
  }
  return { cards, scenes, bounds, problems, fieldsSeen };
}

function pushScenes(to: string[], rows: string[][]): void {
  for (const r of rows.slice(2)) for (const c of r) if (c) to.push(c);
}

/** 読み込んで検証する。おかしければ CardsetError を投げる（サーバーは起動しない） */
export function loadCardset(text: string, version: string): Cardset {
  const p = parseCards(text);
  const problems = [...p.problems];
  const cards = Object.values(p.cards);
  if (cards.length === 0) problems.push("カードが1枚もありません");

  for (const c of cards) {
    const seen = p.fieldsSeen[c.id] ?? [];
    for (const name of REQUIRED_FIELDS) {
      if (!seen.includes(name)) problems.push(`${c.id}：「${name}」がありません`);
    }
    const list = p.scenes[c.mode];
    if (c.scene && !list.includes(c.scene)) {
      problems.push(`${c.id}：場面「${c.scene}」が場面の選択肢リスト（${c.mode === "T" ? "3-1" : "3-2"}）にありません`);
    }
    if (c.options.length < 2) problems.push(`${c.id}：目的の選択肢が2つ未満です`);
    if (c.purpose && !c.options.includes(c.purpose)) {
      problems.push(`${c.id}：目的の選択肢に正解（目的「${c.purpose}」）が含まれていません`);
    }
  }
  for (const mode of ["T", "K"] as const) {
    if (cards.some((c) => c.mode === mode) && p.scenes[mode].length === 0) {
      problems.push(`${mode === "T" ? "3-1" : "3-2"} の場面の選択肢リストが読めません`);
    }
  }
  for (const b of Object.values(p.bounds)) {
    if (!p.scenes[b.mode].includes(b.scene)) {
      problems.push(`対応表（${b.mode === "T" ? "4-1" : "4-2"}）の場面「${b.scene}」が場面の選択肢リストにありません`);
    }
  }
  if (problems.length) throw new CardsetError(version, problems);
  return { version, cards: p.cards, scenes: p.scenes, bounds: p.bounds };
}

/** そのカードの判定の境界（なければ null） */
export function boundOf(cs: Cardset, card: Card): Bound | null {
  return cs.bounds[`${card.mode}:${card.scene}`] ?? null;
}
