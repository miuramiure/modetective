/**
 * 見せ分け（基本設計 4.3）。その人に見せてよいものだけで view を組み立てる。
 * 見せないカードの中身は、view に入れない（画面で隠すのではない）。
 */
import { boundOf, type Bound, type Card, type Cardset } from "./cards.js";
import { REDRAW_LIMIT, cardModeOf, type Settings } from "./deal.js";
import {
  PHASES,
  activeGroups,
  opponentOf,
  parseTeamId,
  teamIds,
  type LogEntry,
  type Phase,
  type Room,
  type Side,
} from "./room.js";

export type Viewer = { kind: "gm" } | { kind: "member"; memberId: string };

export interface MemberSummary {
  /** GM の view にだけ入る（メンバーを移すときに使う） */
  id?: string;
  nickname: string;
  connected: boolean;
}

export interface TeamView {
  id: string;
  group: number;
  side: Side;
  members: MemberSummary[];
  confirmed: boolean;
  /** 確定したメンバーのニックネーム。自動確定なら null */
  confirmedBy: string | null;
  redrawsUsed: number;
  /** 表示中（確定後は確定した）カード。見てよいときだけ入る */
  card?: Card;
  /** 目的の選択肢。カードは見られないが選択肢は見てよいとき（推理フェーズの相手チームなど）にも入る */
  options?: string[];
  /** 判定の境界（該当の行）。見てよいときだけ入る。対応表にない場面なら null */
  bound?: Bound | null;
}

interface ViewBase {
  code: string;
  cardset: string;
  rev: number;
  setNo: number;
  phase: Phase;
  /** いまのセットの設定（配る前は次に配る設定） */
  settings: Settings;
  groups: number;
  redrawLimit: number;
  teams: TeamView[];
  unassigned: MemberSummary[];
  /** 場面の選択肢リスト（そのモードの分）。見てよいときだけ入る */
  scenes?: string[];
}

export interface MemberView extends ViewBase {
  role: "member";
  me: { id: string; nickname: string; team: string | null };
}

export interface GMView extends ViewBase {
  role: "gm";
  /** 次に配るときの設定（集合・振り返りで変えられる） */
  nextSettings: Settings;
  log: LogEntry[];
}

export type View = MemberView | GMView;

/** 見る人と、そのチームとの関係 */
type Relation = "own" | "opponent" | "other" | "gm";

function atLeast(now: Phase, p: Phase): boolean {
  return PHASES.indexOf(now) >= PHASES.indexOf(p);
}

interface Visible {
  card: boolean;
  options: boolean;
  bound: boolean;
}

/** 4.3 の表。カードを配る前（集合）は何も見せない */
export function visibility(rel: Relation, phase: Phase, s: Settings): Visible {
  if (phase === "lobby") return { card: false, options: false, bound: false };
  const p = (x: Phase) => atLeast(phase, x);
  switch (rel) {
    case "own":
      return { card: p("card"), options: p("card"), bound: p("reveal") };
    case "opponent":
      return { card: p("reveal"), options: p("deduce") && s.purposeChoice, bound: p("reveal") };
    case "other":
      return { card: p("review"), options: p("review"), bound: p("review") };
    case "gm":
      return s.gmPlays
        ? { card: p("reveal"), options: p("deduce"), bound: p("reveal") }
        : { card: true, options: true, bound: true };
  }
}

function relationOf(viewerTeam: string | null, team: string): Relation {
  if (viewerTeam === team) return "own";
  if (viewerTeam && opponentOf(viewerTeam) === team) return "opponent";
  return "other";
}

export function viewFor(room: Room, viewer: Viewer, cs: Cardset): View | null {
  const isGM = viewer.kind === "gm";
  const me = viewer.kind === "member" ? room.members.find((m) => m.id === viewer.memberId) : undefined;
  if (!isGM && !me) return null;

  const current = room.dealt ?? room.settings;
  const groups = activeGroups(room);
  const summary = (m: (typeof room.members)[number]): MemberSummary =>
    isGM
      ? { id: m.id, nickname: m.nickname, connected: m.connected }
      : { nickname: m.nickname, connected: m.connected };

  const teams: TeamView[] = teamIds(groups).map((id) => {
    const t = parseTeamId(id) as { group: number; side: Side };
    const st = room.teams[id];
    const tv: TeamView = {
      id,
      group: t.group,
      side: t.side,
      members: room.members.filter((m) => m.team === id).map(summary),
      confirmed: st?.confirmed ?? false,
      confirmedBy: st?.confirmedBy ?? null,
      redrawsUsed: st?.redrawsUsed ?? 0,
    };
    const card = st ? cs.cards[st.cardId] : undefined;
    if (!card) return tv;
    const vis = visibility(isGM ? "gm" : relationOf(me?.team ?? null, id), room.phase, current);
    if (vis.card) tv.card = structuredClone(card);
    if (vis.options) tv.options = [...card.options];
    if (vis.bound) {
      const b = boundOf(cs, card);
      tv.bound = b ? structuredClone(b) : null;
    }
    return tv;
  });

  const base: ViewBase = {
    code: room.code,
    cardset: room.cardset,
    rev: room.rev,
    setNo: room.setNo,
    phase: room.phase,
    settings: { ...current },
    groups,
    redrawLimit: current.dist === "common" ? 0 : REDRAW_LIMIT,
    teams,
    unassigned: room.members.filter((m) => !m.team).map(summary),
  };

  const showScenes = isGM || (!!me?.team && room.phase !== "lobby" && atLeast(room.phase, "deduce"));
  if (showScenes) base.scenes = [...cs.scenes[cardModeOf(current)]];

  if (isGM) {
    return { ...base, role: "gm", nextSettings: { ...room.settings }, log: room.log.map((l) => ({ ...l })) };
  }
  const m = me as NonNullable<typeof me>;
  return { ...base, role: "member", me: { id: m.id, nickname: m.nickname, team: m.team } };
}
