/**
 * カードの配り方と組み合わせ禁止の判定。v1（app.js の deal・conflicts）の移植。
 * 乱数は外から渡す（rand は 0 以上 1 未満を返す関数）。
 */
import type { Card, CardMode, Cardset } from "./cards.js";

export type Rand = () => number;

export const REDRAW_LIMIT = 2;
export const MAX_GROUPS = 10;

export interface Settings {
  /** 共通カード方式／個別カード方式 */
  dist: "common" | "individual";
  /** シナリオモード／聞き込みモード */
  mode: "scenario" | "kikikomi";
  /** 目的の選択肢あり／なし */
  purposeChoice: boolean;
  /** GMも参加する */
  gmPlays: boolean;
  /** グループ数（1〜MAX_GROUPS） */
  groups: number;
}

export const DEFAULT_SETTINGS: Settings = {
  dist: "individual",
  mode: "scenario",
  purposeChoice: true,
  gmPlays: false,
  groups: 1,
};

/** グループごとの A・B の山（引き直し候補を含むカードIDの列）。先頭が最初に配るカード */
export interface Deck {
  A: string[];
  B: string[];
}

export function cardModeOf(s: Pick<Settings, "mode">): CardMode {
  return s.mode === "scenario" ? "T" : "K";
}

/** 設定の形を確かめる。正しければ null、おかしければ理由 */
export function checkSettings(s: unknown): string | null {
  if (typeof s !== "object" || s === null) return "設定がありません。";
  const o = s as Record<string, unknown>;
  if (o.dist !== "common" && o.dist !== "individual")
    return "カードの提示のしかたが正しくありません。";
  if (o.mode !== "scenario" && o.mode !== "kikikomi")
    return "お題のモードが正しくありません。";
  if (typeof o.purposeChoice !== "boolean")
    return "目的の答え方が正しくありません。";
  if (typeof o.gmPlays !== "boolean")
    return "ゲームマスターの参加が正しくありません。";
  if (
    typeof o.groups !== "number" ||
    !Number.isInteger(o.groups) ||
    o.groups < 1 ||
    o.groups > MAX_GROUPS
  ) {
    return `グループ数は1〜${MAX_GROUPS}で選んでください。`;
  }
  return null;
}

/** 余分な項目を落とした設定のコピー */
export function pickSettings(s: Settings): Settings {
  return {
    dist: s.dist,
    mode: s.mode,
    purposeChoice: s.purposeChoice,
    gmPlays: s.gmPlays,
    groups: s.groups,
  };
}

export function shuffle<T>(arr: readonly T[], rand: Rand): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

/** 乱数の種から乱数列を作る（mulberry32。v1 の rng と同じ） */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 同じグループの A と B に組み合わせてはいけないか。
 * 同じカード、同じ場面、第4部の対応表で同じ行に入る場面、カードの「補足」に書かれた組み合わせ。
 */
export function conflicts(cs: Cardset, a: Card, b: Card): boolean {
  if (a.id === b.id || a.scene === b.scene) return true;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const k of ["T:", "K:"]) {
      const bd = cs.bounds[k + x.scene];
      if (bd && bd.near.includes(y.scene)) return true;
    }
    if (x.note && x.note.includes(y.id)) return true;
  }
  return false;
}

export class DealError extends Error {
  constructor() {
    super("カードを配れませんでした（カードの枚数が足りない可能性があります）");
    this.name = "DealError";
  }
}

/**
 * カードを配る。個別カード方式はグループごとに、共通カード方式は全グループ共通の1組を返す。
 * A の山のどのカードと B の山のどのカードを組み合わせても、組み合わせ禁止にならない。
 */
export function deal(cs: Cardset, settings: Settings, rand: Rand): Deck[] {
  const mode = cardModeOf(settings);
  const ids = Object.keys(cs.cards).filter((id) => id[0] === mode);
  const C = (id: string): Card => cs.cards[id] as Card;
  const poolSize = settings.dist === "common" ? 1 : 1 + REDRAW_LIMIT;
  const groups = settings.dist === "common" ? 1 : settings.groups;
  const out: Deck[] = [];
  const used: Record<string, number> = {}; // 使った回数（グループ間でなるべくばらけさせる）
  for (let g = 0; g < groups; g++) {
    let best: Deck | null = null;
    for (let attempt = 0; attempt < 400 && !best; attempt++) {
      const order = shuffle(ids, rand).sort(
        (x, y) => (used[x] ?? 0) - (used[y] ?? 0),
      );
      const A: string[] = [];
      const B: string[] = [];
      for (const id of order) {
        if (
          A.length < poolSize &&
          !B.includes(id) &&
          B.every((b) => !conflicts(cs, C(id), C(b)))
        ) {
          A.push(id);
          continue;
        }
        if (
          B.length < poolSize &&
          !A.includes(id) &&
          A.every((a) => !conflicts(cs, C(id), C(a)))
        ) {
          B.push(id);
        }
        if (A.length === poolSize && B.length === poolSize) break;
      }
      if (A.length === poolSize && B.length === poolSize) best = { A, B };
    }
    if (!best) throw new DealError();
    for (const id of [...best.A, ...best.B]) used[id] = (used[id] ?? 0) + 1;
    out.push(best);
  }
  return out;
}
