/**
 * 部屋の状態とフェーズの進み方（基本設計 4.1・4.2）。
 * どの関数も、受け取った部屋を書き換えず、新しい部屋を返す。
 * 時刻（now）・乱数（rand）・トークンのハッシュ・メンバーIDは外から渡す。
 */
import type { Cardset } from "./cards.js";
import {
  DealError,
  REDRAW_LIMIT,
  checkSettings,
  deal,
  pickSettings,
  type Deck,
  type Rand,
  type Settings,
} from "./deal.js";

export const PHASES = [
  "lobby",
  "card",
  "investigate",
  "deduce",
  "reveal",
  "review",
] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: "集合",
  card: "カード提示",
  investigate: "調査フェーズ",
  deduce: "推理フェーズ",
  reveal: "解決編",
  review: "振り返り",
};

export type Side = "A" | "B";

/** 最後の操作から部屋を消すまでの時間（K8） */
export const ROOM_TTL_MS = 48 * 60 * 60 * 1000;
export const LOG_LIMIT = 50;
export const NICKNAME_MAX = 20;
/** 部屋コードに使う文字（読み間違えやすい文字を除く。v1 の事件番号と同じ） */
export const ROOM_CODE_CHARS = "ACDEFGHJKLMNPQRTUVWXY34679";
export const ROOM_CODE_LENGTH = 6;

export interface TeamState {
  /** 表示中のカード */
  cardId: string;
  redrawsUsed: number;
  confirmed: boolean;
  /** 確定したメンバーのニックネーム。自動確定（K4）なら null */
  confirmedBy: string | null;
}

export interface Member {
  id: string;
  tokenHash: string;
  nickname: string;
  /** "G1-A" など。未選択なら null */
  team: string | null;
  connected: boolean;
}

export interface LogEntry {
  at: number;
  text: string;
}

export interface Room {
  code: string;
  /** カードデータの版（部屋を作った時点で固定） */
  cardset: string;
  /** 次に配るときの設定（GMが集合・振り返りで変えられる） */
  settings: Settings;
  /** いまのセットを配ったときの設定。配る前（集合）は null */
  dealt: Settings | null;
  setNo: number;
  phase: Phase;
  decks: Deck[];
  teams: Record<string, TeamState>;
  members: Member[];
  gm: { tokenHash: string };
  log: LogEntry[];
  /** 変更番号。変わるたびに1増える */
  rev: number;
  createdAt: number;
  lastActiveAt: number;
}

export type ErrorCode =
  | "bad_settings"
  | "bad_phase"
  | "bad_team"
  | "not_member"
  | "no_team"
  | "stale"
  | "redraw_not_allowed"
  | "no_redraw_left"
  | "already_confirmed"
  | "bad_nickname"
  | "deal_failed";

export type Failure = { ok: false; code: ErrorCode; message: string };
export type Result<T extends object = object> =
  ({ ok: true; room: Room } & T) | Failure;

function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, code, message };
}

// ===== チーム番号 =====
export function teamId(group: number, side: Side): string {
  return `G${group}-${side}`;
}

export function parseTeamId(id: string): { group: number; side: Side } | null {
  const m = /^G([1-9]\d?)-([AB])$/.exec(id);
  if (!m) return null;
  return { group: Number(m[1]), side: m[2] as Side };
}

export function opponentOf(id: string): string | null {
  const t = parseTeamId(id);
  return t ? teamId(t.group, t.side === "A" ? "B" : "A") : null;
}

/** いまチームとして選べるグループ数。集合では次の設定、配ったあとは配ったときの設定 */
export function activeGroups(room: Room): number {
  return room.dealt ? room.dealt.groups : room.settings.groups;
}

export function teamIds(groups: number): string[] {
  const out: string[] = [];
  for (let g = 1; g <= groups; g++) out.push(teamId(g, "A"), teamId(g, "B"));
  return out;
}

function isActiveTeam(room: Room, id: string): boolean {
  const t = parseTeamId(id);
  return !!t && t.group <= activeGroups(room);
}

/** そのチームの山（引き直し候補を含む） */
export function deckOf(room: Room, id: string): string[] {
  const t = parseTeamId(id);
  if (!t || !room.dealt) return [];
  const d = room.decks[room.dealt.dist === "common" ? 0 : t.group - 1];
  return d ? d[t.side] : [];
}

// ===== 小道具 =====
function clone(room: Room): Room {
  return structuredClone(room);
}

function touch(room: Room, now: number): void {
  room.rev += 1;
  room.lastActiveAt = now;
}

function addLog(room: Room, now: number, text: string): void {
  room.log.push({ at: now, text });
  if (room.log.length > LOG_LIMIT)
    room.log.splice(0, room.log.length - LOG_LIMIT);
}

function findMember(room: Room, memberId: string): Member | undefined {
  return room.members.find((m) => m.id === memberId);
}

export function findMemberByToken(
  room: Room,
  tokenHash: string,
): Member | undefined {
  return room.members.find((m) => m.tokenHash === tokenHash);
}

export function isExpired(room: Room, now: number): boolean {
  return now - room.lastActiveAt >= ROOM_TTL_MS;
}

export function makeRoomCode(rand: Rand): string {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_CHARS[Math.floor(rand() * ROOM_CODE_CHARS.length)];
  }
  return s;
}

/** 制御文字（ニックネームから除く） */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** ニックネームを整える。使えなければ null */
export function normalizeNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .normalize("NFKC")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || [...s].length > NICKNAME_MAX) return null;
  return s;
}

/** 部屋の中で重ならない名前にする（重なったら「佐藤(2)」） */
function uniqueNickname(room: Room, name: string): string {
  const taken = new Set(room.members.map((m) => m.nickname));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const c = `${name}(${n})`;
    if (!taken.has(c)) return c;
  }
}

/** 配る。いまの settings で山を作り、チームを最初のカードにする */
function dealInto(
  room: Room,
  cs: Cardset,
  rand: Rand,
  now: number,
): Failure | null {
  let decks: Deck[];
  try {
    decks = deal(cs, room.settings, rand);
  } catch (e) {
    if (e instanceof DealError) return fail("deal_failed", e.message);
    throw e;
  }
  room.decks = decks;
  room.dealt = pickSettings(room.settings);
  room.teams = {};
  for (const id of teamIds(room.dealt.groups)) {
    const first = deckOf(room, id)[0];
    if (!first) return fail("deal_failed", "カードを配れませんでした。");
    room.teams[id] = {
      cardId: first,
      redrawsUsed: 0,
      confirmed: false,
      confirmedBy: null,
    };
  }
  // なくなったグループにいたメンバーはチーム未選択に戻す
  for (const m of room.members) {
    if (m.team && !isActiveTeam(room, m.team)) m.team = null;
  }
  addLog(room, now, `セット${room.setNo}のカードを配りました`);
  return null;
}

// ===== 部屋を作る =====
export function createRoom(args: {
  code: string;
  gmTokenHash: string;
  settings: unknown;
  cardset: string;
  now: number;
}): Result {
  const bad = checkSettings(args.settings);
  if (bad) return fail("bad_settings", bad);
  const room: Room = {
    code: args.code,
    cardset: args.cardset,
    settings: pickSettings(args.settings as Settings),
    dealt: null,
    setNo: 1,
    phase: "lobby",
    decks: [],
    teams: {},
    members: [],
    gm: { tokenHash: args.gmTokenHash },
    log: [],
    rev: 1,
    createdAt: args.now,
    lastActiveAt: args.now,
  };
  addLog(room, args.now, "部屋を作りました");
  return { ok: true, room };
}

// ===== GM の操作 =====
/** 設定を変える（集合と振り返りのときだけ）。振り返りで変えた設定は次のセットから効く */
export function updateSettings(
  src: Room,
  settings: unknown,
  now: number,
): Result {
  if (src.phase !== "lobby" && src.phase !== "review") {
    return fail("bad_phase", "設定は、集合と振り返りのときだけ変えられます。");
  }
  const bad = checkSettings(settings);
  if (bad) return fail("bad_settings", bad);
  const room = clone(src);
  room.settings = pickSettings(settings as Settings);
  if (room.phase === "lobby") {
    for (const m of room.members) {
      if (m.team && !isActiveTeam(room, m.team)) m.team = null;
    }
  }
  addLog(room, now, "設定を変えました");
  touch(room, now);
  return { ok: true, room };
}

/**
 * フェーズを1つ進める／1つ戻す。
 * - 集合→カード提示：カードを配る
 * - カード提示→調査：未確定のチームは表示中のカードで自動確定（K4）
 * - カード提示→集合（戻す）：配ったカードを取り消す（集合で設定を直して配り直せる）
 * - 振り返りから先は nextSet を使う
 * - ほかの「戻す」は、確定したカードを変えない
 */
export function setPhase(
  src: Room,
  to: Phase,
  ctx: { cardset: Cardset; rand: Rand; now: number },
): Result {
  const from = PHASES.indexOf(src.phase);
  const target = PHASES.indexOf(to);
  if (target < 0) return fail("bad_phase", "フェーズが正しくありません。");
  if (target !== from + 1 && target !== from - 1) {
    return fail("bad_phase", "フェーズは1つずつ進める（戻す）ことができます。");
  }
  const room = clone(src);
  const { now } = ctx;

  if (src.phase === "lobby" && to === "card") {
    const err = dealInto(room, ctx.cardset, ctx.rand, now);
    if (err) return err;
  } else if (src.phase === "card" && to === "investigate") {
    for (const [id, t] of Object.entries(room.teams)) {
      if (!t.confirmed) {
        t.confirmed = true;
        t.confirmedBy = null;
        addLog(room, now, `${id}：表示中のカードで自動で確定しました`);
      }
    }
  } else if (src.phase === "card" && to === "lobby") {
    room.decks = [];
    room.teams = {};
    room.dealt = null;
    addLog(room, now, "配ったカードを取り消しました");
  }
  room.phase = to;
  addLog(
    room,
    now,
    `${target > from ? "進めました" : "戻しました"}：${PHASE_LABELS[to]}`,
  );
  touch(room, now);
  return { ok: true, room };
}

/** 次のセット（K5）。同じ部屋・チーム分けのまま、カードを配り直してカード提示へ */
export function nextSet(
  src: Room,
  ctx: { cardset: Cardset; rand: Rand; now: number },
): Result {
  if (src.phase !== "review")
    return fail("bad_phase", "次のセットは、振り返りのときに始められます。");
  const room = clone(src);
  room.setNo += 1;
  const err = dealInto(room, ctx.cardset, ctx.rand, ctx.now);
  if (err) return err;
  room.phase = "card";
  touch(room, ctx.now);
  return { ok: true, room };
}

/** GM がメンバーをほかのチームへ移す（null なら未選択へ） */
export function moveMember(
  src: Room,
  memberId: string,
  team: string | null,
  now: number,
): Result {
  const r = changeTeam(src, memberId, team);
  if (!r.ok) return r;
  const m = findMember(r.room, memberId) as Member;
  addLog(
    r.room,
    now,
    `GMが${m.nickname}さんを${team ?? "チーム未選択"}へ移しました`,
  );
  touch(r.room, now);
  return r;
}

// ===== 参加者の操作 =====
export function join(
  src: Room,
  args: { id: string; tokenHash: string; nickname: unknown },
  now: number,
): Result<{ member: Member }> {
  const name = normalizeNickname(args.nickname);
  if (!name)
    return fail(
      "bad_nickname",
      `ニックネームは1〜${NICKNAME_MAX}文字で入れてください。`,
    );
  const room = clone(src);
  const member: Member = {
    id: args.id,
    tokenHash: args.tokenHash,
    nickname: uniqueNickname(room, name),
    team: null,
    connected: true,
  };
  room.members.push(member);
  addLog(room, now, `${member.nickname}さんが参加しました`);
  touch(room, now);
  return { ok: true, room, member: { ...member } };
}

function changeTeam(src: Room, memberId: string, team: string | null): Result {
  if (!findMember(src, memberId))
    return fail("not_member", "メンバーが見つかりません。");
  if (team !== null && !isActiveTeam(src, team))
    return fail("bad_team", "チームが正しくありません。");
  const room = clone(src);
  (findMember(room, memberId) as Member).team = team;
  return { ok: true, room };
}

/** チームを選ぶ・変える（いつでもできる。null なら未選択へ） */
export function chooseTeam(
  src: Room,
  memberId: string,
  team: string | null,
  now: number,
): Result {
  const r = changeTeam(src, memberId, team);
  if (!r.ok) return r;
  const m = findMember(r.room, memberId) as Member;
  addLog(
    r.room,
    now,
    team
      ? `${m.nickname}さんが${team}を選びました`
      : `${m.nickname}さんがチームを外れました`,
  );
  touch(r.room, now);
  return r;
}

/** 引き直し・確定の共通の確かめ。古い画面からの二重押しは stale で弾く */
function checkCardOp(
  room: Room,
  memberId: string,
  req: { setNo: unknown; cardId: unknown },
): { member: Member; team: TeamState; teamId: string } | Failure {
  const member = findMember(room, memberId);
  if (!member) return fail("not_member", "メンバーが見つかりません。");
  if (room.phase !== "card")
    return fail("bad_phase", "いまはカードを選ぶフェーズではありません。");
  if (!member.team) return fail("no_team", "先にチームを選んでください。");
  const team = room.teams[member.team];
  if (!team) return fail("no_team", "チームが見つかりません。");
  if (req.setNo !== room.setNo || req.cardId !== team.cardId) {
    return fail(
      "stale",
      "画面が古くなっています。最新のカードを確かめてください。",
    );
  }
  if (team.confirmed)
    return fail("already_confirmed", "このチームのカードは確定しています。");
  return { member, team, teamId: member.team };
}

export function redraw(
  src: Room,
  memberId: string,
  req: { setNo: unknown; cardId: unknown },
  now: number,
): Result {
  const room = clone(src);
  const c = checkCardOp(room, memberId, req);
  if ("ok" in c) return c;
  if (room.dealt?.dist === "common") {
    return fail(
      "redraw_not_allowed",
      "共通カード方式なので、カードの引き直しはできません。",
    );
  }
  const next = deckOf(room, c.teamId)[c.team.redrawsUsed + 1];
  if (c.team.redrawsUsed >= REDRAW_LIMIT || !next) {
    return fail("no_redraw_left", "引き直しの回数が残っていません。");
  }
  c.team.redrawsUsed += 1;
  c.team.cardId = next;
  addLog(
    room,
    now,
    `${c.teamId}：${c.member.nickname}さんが引き直しました（あと${REDRAW_LIMIT - c.team.redrawsUsed}回）`,
  );
  touch(room, now);
  return { ok: true, room };
}

export function confirm(
  src: Room,
  memberId: string,
  req: { setNo: unknown; cardId: unknown },
  now: number,
): Result {
  const room = clone(src);
  const c = checkCardOp(room, memberId, req);
  if ("ok" in c) return c;
  c.team.confirmed = true;
  c.team.confirmedBy = c.member.nickname;
  addLog(room, now, `${c.teamId}：${c.member.nickname}さんが確定しました`);
  touch(room, now);
  return { ok: true, room };
}

/** GM のトークンを差し替える（別の端末から「部屋コード＋GM合言葉」で入り直したとき） */
export function setGmToken(src: Room, tokenHash: string, now: number): Result {
  const room = clone(src);
  room.gm = { tokenHash };
  addLog(room, now, "GMが入り直しました");
  touch(room, now);
  return { ok: true, room };
}

/** 接続状態を変える（出来事の記録には残さない） */
export function setConnected(
  src: Room,
  memberId: string,
  connected: boolean,
): Result {
  const m0 = findMember(src, memberId);
  if (!m0) return fail("not_member", "メンバーが見つかりません。");
  if (m0.connected === connected) return { ok: true, room: src };
  const room = clone(src);
  (findMember(room, memberId) as Member).connected = connected;
  room.rev += 1;
  return { ok: true, room };
}
