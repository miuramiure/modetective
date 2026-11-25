import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, REDRAW_LIMIT } from "./deal.js";
import {
  LOG_LIMIT,
  ROOM_CODE_CHARS,
  ROOM_TTL_MS,
  chooseTeam,
  confirm,
  createRoom,
  deckOf,
  isExpired,
  join,
  makeRoomCode,
  moveMember,
  nextSet,
  normalizeNickname,
  redraw,
  setConnected,
  setPhase,
  updateSettings,
  type Phase,
  type Room,
} from "./room.js";
import { firstMemberOf, ok, rand, roomWithMembers, v04 } from "./test/helpers.js";

const cs = v04();
const ctx = (seed = 1, now = 5000) => ({ cardset: cs, rand: rand(seed), now });
const go = (room: Room, to: Phase, seed = 1) => ok(setPhase(room, to, ctx(seed)));
const dealt = (settings = {}) => go(roomWithMembers(settings), "card");
const cardReq = (room: Room, team: string) => ({ setNo: room.setNo, cardId: room.teams[team]!.cardId });

describe("部屋を作る", () => {
  it("集合から始まり、カードはまだ配らない", () => {
    const r = ok(createRoom({ code: "ACDEFG", gmTokenHash: "h", settings: DEFAULT_SETTINGS, cardset: "v0.4", now: 1 }));
    expect(r).toMatchObject({ phase: "lobby", setNo: 1, dealt: null, decks: [], teams: {}, members: [] });
  });
  it("設定がおかしければ作らない", () => {
    const r = createRoom({ code: "X", gmTokenHash: "h", settings: { groups: 3 }, cardset: "v0.4", now: 1 });
    expect(r).toMatchObject({ ok: false, code: "bad_settings" });
  });
  it("状態は JSON にして戻しても同じ", () => {
    const r = dealt({ groups: 2 });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it("部屋コードは6文字で、決めた文字だけを使う", () => {
    const r = rand(9);
    for (let i = 0; i < 200; i++) {
      const c = makeRoomCode(r);
      expect(c).toHaveLength(6);
      for (const ch of c) expect(ROOM_CODE_CHARS).toContain(ch);
    }
  });
});

describe("参加とチーム", () => {
  it("同じニックネームは「佐藤(2)」にする", () => {
    let r = roomWithMembers({}, { perTeam: 0, unassigned: 0 });
    r = ok(join(r, { id: "a", tokenHash: "ta", nickname: " 佐藤 " }, 1));
    r = ok(join(r, { id: "b", tokenHash: "tb", nickname: "佐藤" }, 2));
    r = ok(join(r, { id: "c", tokenHash: "tc", nickname: "佐藤" }, 3));
    expect(r.members.map((m) => m.nickname)).toEqual(["佐藤", "佐藤(2)", "佐藤(3)"]);
  });
  it("ニックネームが空・長すぎるときは入れない", () => {
    const r = roomWithMembers();
    expect(join(r, { id: "x", tokenHash: "t", nickname: "  " }, 1)).toMatchObject({ code: "bad_nickname" });
    expect(join(r, { id: "x", tokenHash: "t", nickname: "あ".repeat(21) }, 1)).toMatchObject({ code: "bad_nickname" });
    expect(join(r, { id: "x", tokenHash: "t", nickname: 3 }, 1)).toMatchObject({ code: "bad_nickname" });
    expect(normalizeNickname("ｻﾄｳ\u0007")).toBe("サトウ");
  });
  it("ないチームは選べない。チームはいつでも変えられる", () => {
    let r = dealt({ groups: 2 });
    expect(chooseTeam(r, "m1", "G3-A", 1)).toMatchObject({ code: "bad_team" });
    expect(chooseTeam(r, "m1", "G1-C", 1)).toMatchObject({ code: "bad_team" });
    expect(chooseTeam(r, "nobody", "G1-A", 1)).toMatchObject({ code: "not_member" });
    r = go(go(r, "investigate"), "deduce");
    r = ok(chooseTeam(r, "m1", "G2-B", 1));
    expect(r.members.find((m) => m.id === "m1")?.team).toBe("G2-B");
  });
  it("GM はメンバーをほかのチームや未選択へ移せる", () => {
    let r = dealt({ groups: 2 });
    r = ok(moveMember(r, "m1", "G2-A", 1));
    expect(r.members.find((m) => m.id === "m1")?.team).toBe("G2-A");
    r = ok(moveMember(r, "m1", null, 1));
    expect(r.members.find((m) => m.id === "m1")?.team).toBeNull();
    expect(r.log.at(-1)?.text).toContain("チーム未選択");
  });
  it("接続状態を変えられる。変わらなければ同じ部屋を返す", () => {
    const r = roomWithMembers();
    const r2 = ok(setConnected(r, "m1", false));
    expect(r2.members[0]?.connected).toBe(false);
    expect(r2.rev).toBe(r.rev + 1);
    expect(ok(setConnected(r2, "m1", false))).toBe(r2);
  });
});

describe("フェーズ", () => {
  it("1つずつしか進めない・戻せない", () => {
    const r = roomWithMembers();
    expect(setPhase(r, "investigate", ctx())).toMatchObject({ code: "bad_phase" });
    expect(setPhase(r, "review", ctx())).toMatchObject({ code: "bad_phase" });
    expect(setPhase(r, "nope" as Phase, ctx())).toMatchObject({ code: "bad_phase" });
  });
  it("集合→カード提示でカードを配る（各チームは山の先頭）", () => {
    const r = dealt({ groups: 3 });
    expect(r.dealt).toEqual({ ...DEFAULT_SETTINGS, groups: 3 });
    expect(Object.keys(r.teams)).toEqual(["G1-A", "G1-B", "G2-A", "G2-B", "G3-A", "G3-B"]);
    for (const [id, t] of Object.entries(r.teams)) {
      expect(t).toEqual({ cardId: deckOf(r, id)[0], redrawsUsed: 0, confirmed: false, confirmedBy: null });
    }
  });
  it("共通カード方式は全グループの A（B）に同じカード", () => {
    const r = dealt({ groups: 3, dist: "common" });
    expect(r.decks).toHaveLength(1);
    expect(new Set(["G1-A", "G2-A", "G3-A"].map((t) => r.teams[t]!.cardId)).size).toBe(1);
    expect(r.teams["G1-A"]!.cardId).not.toBe(r.teams["G1-B"]!.cardId);
  });
  it("調査フェーズへ進むと、未確定のチームは表示中のカードで自動確定する（K4）", () => {
    let r = dealt();
    r = ok(confirm(r, firstMemberOf(r, "G1-A"), cardReq(r, "G1-A"), 1));
    const before = r.teams["G1-B"]!.cardId;
    r = go(r, "investigate");
    expect(r.teams["G1-A"]).toMatchObject({ confirmed: true, confirmedBy: "参加者1" });
    expect(r.teams["G1-B"]).toMatchObject({ confirmed: true, confirmedBy: null, cardId: before });
  });
  it("戻しても確定したカードは変わらない", () => {
    let r = go(go(go(dealt(), "investigate"), "deduce"), "reveal");
    const teams = structuredClone(r.teams);
    r = go(go(go(r, "deduce"), "investigate"), "card");
    expect(r.phase).toBe("card");
    expect(r.teams).toEqual(teams);
    // 確定済みなので引き直せない
    expect(redraw(r, "m1", cardReq(r, "G1-A"), 1)).toMatchObject({ code: "already_confirmed" });
  });
  it("カード提示→集合へ戻すと、配ったカードを取り消す。配り直せる", () => {
    let r = dealt({ groups: 2 });
    r = go(r, "lobby");
    expect(r).toMatchObject({ phase: "lobby", dealt: null, decks: [], teams: {}, setNo: 1 });
    expect(r.members.filter((m) => m.team)).toHaveLength(8); // チーム分けは残る
    r = ok(updateSettings(r, { ...DEFAULT_SETTINGS, groups: 2, mode: "kikikomi" }, 1));
    r = go(r, "card", 99);
    expect(r.teams["G1-A"]!.cardId[0]).toBe("K");
  });
  it("振り返りからは setPhase で進めない（次のセットを使う）", () => {
    const r = go(go(go(go(dealt(), "investigate"), "deduce"), "reveal"), "review");
    expect(setPhase(r, "card", ctx())).toMatchObject({ code: "bad_phase" });
    expect(ok(setPhase(r, "reveal", ctx())).phase).toBe("reveal");
  });
  it("受け取った部屋は書き換えない", () => {
    const r = dealt();
    const snap = structuredClone(r);
    go(r, "investigate");
    redraw(r, "m1", cardReq(r, "G1-A"), 1);
    confirm(r, "m1", cardReq(r, "G1-A"), 1);
    chooseTeam(r, "m1", "G1-B", 1);
    expect(r).toEqual(snap);
  });
  it("変更のたびに rev が増え、lastActiveAt が更新される", () => {
    const r = dealt();
    const r2 = ok(confirm(r, "m1", cardReq(r, "G1-A"), 777_777));
    expect(r2.rev).toBe(r.rev + 1);
    expect(r2.lastActiveAt).toBe(777_777);
  });
});

describe("引き直しと確定", () => {
  it(`引き直しは山の順に ${REDRAW_LIMIT} 回まで`, () => {
    let r = dealt();
    const deck = deckOf(r, "G1-A");
    for (let i = 1; i <= REDRAW_LIMIT; i++) {
      r = ok(redraw(r, "m1", cardReq(r, "G1-A"), i));
      expect(r.teams["G1-A"]).toMatchObject({ cardId: deck[i], redrawsUsed: i });
    }
    expect(redraw(r, "m1", cardReq(r, "G1-A"), 9)).toMatchObject({ code: "no_redraw_left" });
    expect(r.log.at(-1)?.text).toBe("G1-A：参加者1さんが引き直しました（あと0回）");
  });
  it("チームの誰が押してもよく、古い画面からの二重押しは弾く（K3）", () => {
    let r = dealt();
    const req = cardReq(r, "G1-A");
    r = ok(redraw(r, "m1", req, 1)); // 1人目
    expect(redraw(r, "m2", req, 1)).toMatchObject({ code: "stale" }); // 同じ画面を見ていた2人目
    expect(confirm(r, "m2", req, 1)).toMatchObject({ code: "stale" });
    expect(confirm(r, "m2", { ...cardReq(r, "G1-A"), setNo: 2 }, 1)).toMatchObject({ code: "stale" });
    r = ok(confirm(r, "m2", cardReq(r, "G1-A"), 1));
    expect(r.teams["G1-A"]).toMatchObject({ confirmed: true, confirmedBy: "参加者2" });
    expect(confirm(r, "m1", cardReq(r, "G1-A"), 1)).toMatchObject({ code: "already_confirmed" });
  });
  it("共通カード方式では引き直せない", () => {
    const r = dealt({ dist: "common" });
    expect(redraw(r, "m1", cardReq(r, "G1-A"), 1)).toMatchObject({ code: "redraw_not_allowed" });
    expect(ok(confirm(r, "m1", cardReq(r, "G1-A"), 1)).teams["G1-A"]?.confirmed).toBe(true);
  });
  it("カード提示のときだけ。チーム未選択のメンバーはできない", () => {
    const r = dealt();
    const unassigned = r.members.find((m) => !m.team)!.id;
    expect(redraw(r, unassigned, { setNo: 1, cardId: "T01" }, 1)).toMatchObject({ code: "no_team" });
    const r2 = go(r, "investigate");
    expect(redraw(r2, "m1", cardReq(r2, "G1-A"), 1)).toMatchObject({ code: "bad_phase" });
    expect(redraw(r, "nobody", cardReq(r, "G1-A"), 1)).toMatchObject({ code: "not_member" });
  });
});

describe("設定と次のセット", () => {
  const toReview = (r: Room) => go(go(go(go(r, "investigate"), "deduce"), "reveal"), "review");

  it("設定は集合と振り返りのときだけ変えられる", () => {
    const r = dealt();
    expect(updateSettings(r, DEFAULT_SETTINGS, 1)).toMatchObject({ code: "bad_phase" });
    expect(updateSettings(roomWithMembers(), { ...DEFAULT_SETTINGS, groups: 0 }, 1)).toMatchObject({
      code: "bad_settings",
    });
  });
  it("次のセット：チーム分けを残してカードを配り直し、カード提示へ（K5）", () => {
    let r = dealt({ groups: 2 });
    r = ok(redraw(r, "m1", cardReq(r, "G1-A"), 1));
    r = toReview(r);
    const teamsOfMembers = r.members.map((m) => m.team);
    r = ok(nextSet(r, ctx(77)));
    expect(r).toMatchObject({ phase: "card", setNo: 2 });
    expect(r.members.map((m) => m.team)).toEqual(teamsOfMembers);
    for (const t of Object.values(r.teams)) expect(t).toMatchObject({ redrawsUsed: 0, confirmed: false });
    // 古いセットの画面からの操作は弾く
    expect(redraw(r, "m1", { setNo: 1, cardId: r.teams["G1-A"]!.cardId }, 1)).toMatchObject({ code: "stale" });
  });
  it("次のセットは振り返りからだけ", () => {
    expect(nextSet(dealt(), ctx())).toMatchObject({ code: "bad_phase" });
  });
  it("振り返りで変えた設定は、次のセットから効く", () => {
    let r = toReview(dealt({ groups: 2 }));
    r = ok(updateSettings(r, { ...DEFAULT_SETTINGS, groups: 2, mode: "kikikomi", gmPlays: true }, 1));
    expect(r.dealt).toMatchObject({ mode: "scenario", gmPlays: false });
    r = ok(nextSet(r, ctx()));
    expect(r.dealt).toMatchObject({ mode: "kikikomi", gmPlays: true });
    expect(r.teams["G1-A"]!.cardId[0]).toBe("K");
  });
  it("グループ数を減らすと、なくなったグループのメンバーはチーム未選択に戻る", () => {
    // 集合で減らした：すぐに戻る
    let r = roomWithMembers({ groups: 3 });
    r = ok(updateSettings(r, { ...DEFAULT_SETTINGS, groups: 2 }, 1));
    expect(r.members.filter((m) => m.team?.startsWith("G3"))).toHaveLength(0);
    expect(r.members.filter((m) => !m.team)).toHaveLength(5);
    // 振り返りで減らした：いまのセットのあいだはそのまま、次に配るときに戻る
    let s = toReview(dealt({ groups: 3 }));
    s = ok(updateSettings(s, { ...DEFAULT_SETTINGS, groups: 1 }, 1));
    expect(s.members.filter((m) => m.team?.startsWith("G3"))).toHaveLength(4);
    s = ok(nextSet(s, ctx()));
    expect(s.members.filter((m) => m.team && m.team !== "G1-A" && m.team !== "G1-B")).toHaveLength(0);
    expect(Object.keys(s.teams)).toEqual(["G1-A", "G1-B"]);
  });
});

describe("出来事の記録と期限", () => {
  it(`記録は最新 ${LOG_LIMIT} 件だけ残す`, () => {
    let r = roomWithMembers({}, { perTeam: 0, unassigned: 0 });
    for (let i = 0; i < 80; i++) r = ok(join(r, { id: `x${i}`, tokenHash: `t${i}`, nickname: `人${i}` }, i));
    expect(r.log).toHaveLength(LOG_LIMIT);
    expect(r.log.at(-1)?.text).toBe("人79さんが参加しました");
  });
  it("最後の操作から48時間で期限切れ（K8）", () => {
    const r = roomWithMembers();
    expect(isExpired(r, r.lastActiveAt + ROOM_TTL_MS - 1)).toBe(false);
    expect(isExpired(r, r.lastActiveAt + ROOM_TTL_MS)).toBe(true);
  });
});
