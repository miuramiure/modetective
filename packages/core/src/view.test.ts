/**
 * 見せ分け（基本設計 4.3）のテスト。
 * 期待値は core の visibility を使わず、設計書の表をここに書き写して確かめる。
 */
import { describe, expect, it } from "vitest";
import { boundOf, type Card } from "./cards.js";
import { DEFAULT_SETTINGS, type Settings } from "./deal.js";
import {
  PHASES,
  confirm,
  deckOf,
  opponentOf,
  redraw,
  setPhase,
  type Phase,
  type Room,
} from "./room.js";
import { firstMemberOf, ok, rand, roomWithMembers, v04 } from "./test/helpers.js";
import { viewFor, type GMView, type MemberView, type Viewer } from "./view.js";

const cs = v04();
const idx = (p: Phase) => PHASES.indexOf(p);
const from = (p: Phase) => (now: Phase) => now !== "lobby" && idx(now) >= idx(p);
const always = (now: Phase) => now !== "lobby"; // 配る前は見せるカードがない
const never = () => false;

/** 基本設計 4.3 の表（行＝情報、列＝見る人） */
const TABLE = {
  card: {
    own: from("card"),
    opponent: from("reveal"),
    other: from("review"),
    gmOff: always,
    gmOn: from("reveal"),
  },
  options: {
    own: from("card"),
    opponent: (now: Phase, s: Settings) => s.purposeChoice && from("deduce")(now),
    other: from("review"),
    gmOff: always,
    gmOn: from("deduce"),
  },
  bound: {
    own: from("reveal"),
    opponent: from("reveal"),
    other: from("review"),
    gmOff: always,
    gmOn: from("reveal"),
  },
  // 場面の選択肢リスト：自チーム deduce〜、相手・他グループ ―、GM 常に
  scenes: { member: from("deduce"), unassigned: never, gm: (now: Phase) => idx(now) >= 0 },
} as const;

type Col = "own" | "opponent" | "other" | "gmOff" | "gmOn";
const colOf = (viewerTeam: string | null | "gm", team: string, s: Settings): Col => {
  if (viewerTeam === "gm") return s.gmPlays ? "gmOn" : "gmOff";
  if (viewerTeam === team) return "own";
  if (viewerTeam && opponentOf(viewerTeam) === team) return "opponent";
  return "other";
};

/** 部屋を指定のフェーズまで進める。途中で引き直し・確定をはさむ */
function roomAt(settings: Settings, phase: Phase, seed: number): Room {
  let r = roomWithMembers(settings, { perTeam: 2, unassigned: 1 });
  if (phase === "lobby") return r;
  const step = (to: Phase) => (r = ok(setPhase(r, to, { cardset: cs, rand: rand(seed), now: 2000 })));
  step("card");
  if (settings.dist === "individual") {
    // G1-A は2回引き直す（前のカードは見せてはいけない）
    for (let i = 0; i < 2; i++) {
      const t = r.teams["G1-A"]!;
      r = ok(redraw(r, firstMemberOf(r, "G1-A"), { setNo: r.setNo, cardId: t.cardId }, 3000));
    }
  }
  const b = r.teams["G1-B"]!;
  r = ok(confirm(r, firstMemberOf(r, "G1-B"), { setNo: r.setNo, cardId: b.cardId }, 3001));
  for (const p of PHASES.slice(2)) {
    if (idx(p) > idx(phase)) break;
    step(p);
  }
  return r;
}

const SETTINGS: Settings[] = [];
for (const dist of ["individual", "common"] as const)
  for (const mode of ["scenario", "kikikomi"] as const)
    for (const purposeChoice of [true, false])
      for (const gmPlays of [false, true])
        SETTINGS.push({ ...DEFAULT_SETTINGS, dist, mode, purposeChoice, gmPlays, groups: 3 });

const cases = SETTINGS.flatMap((s) => PHASES.map((phase) => ({ s, phase })));
const label = ({ s, phase }: { s: Settings; phase: Phase }) =>
  `${phase} / ${s.dist} / ${s.mode} / 選択肢${s.purposeChoice ? "あり" : "なし"} / GM${s.gmPlays ? "参加" : "不参加"}`;

function viewersOf(r: Room): { viewer: Viewer; team: string | null | "gm" }[] {
  return [
    { viewer: { kind: "gm" }, team: "gm" },
    ...r.members.map((m) => ({ viewer: { kind: "member", memberId: m.id } as Viewer, team: m.team })),
  ];
}

describe.each(cases.map((c) => ({ ...c, name: label(c) })))("見せ分け：$name", ({ s, phase }) => {
  for (const seed of [1, 2]) {
    const r = roomAt(s, phase, seed);
    it(`表のとおりに見せる（seed ${seed}）`, () => {
      for (const { viewer, team: vt } of viewersOf(r)) {
        const v = viewFor(r, viewer, cs)!;
        expect(v.role).toBe(viewer.kind);
        for (const tv of v.teams) {
          const st = r.teams[tv.id];
          const col = colOf(vt, tv.id, s);
          const card = st ? cs.cards[st.cardId] : undefined;
          const want = (row: "card" | "options" | "bound") => !!card && TABLE[row][col](phase, s);
          const who = `${viewer.kind === "gm" ? "GM" : vt ?? "未選択"} → ${tv.id}`;
          expect(tv.card, `${who} のカード`).toEqual(want("card") ? card : undefined);
          expect(tv.options, `${who} の目的の選択肢`).toEqual(want("options") ? card!.options : undefined);
          expect(tv.bound, `${who} の判定の境界`).toEqual(want("bound") ? boundOf(cs, card!) : undefined);
          // メンバー名・確定の有無は常に
          expect(tv.members.map((m) => m.nickname)).toEqual(
            r.members.filter((m) => m.team === tv.id).map((m) => m.nickname),
          );
          expect(tv.confirmed).toBe(st?.confirmed ?? false);
        }
        const sceneRule =
          vt === "gm" ? TABLE.scenes.gm : vt === null ? TABLE.scenes.unassigned : TABLE.scenes.member;
        expect(v.scenes !== undefined, `${vt} の場面の選択肢リスト`).toBe(sceneRule(phase));
      }
    });

    it(`送信データに見せてはいけない文字列が入っていない（seed ${seed}）`, () => {
      for (const { viewer, team: vt } of viewersOf(r)) {
        const json = JSON.stringify(viewFor(r, viewer, cs));
        // 表から「見てよいもの」を組み立てる（view からではなく）
        const allowed: string[] = [];
        const shown = new Set<string>();
        for (const [team, st] of Object.entries(r.teams)) {
          const col = colOf(vt, team, s);
          const card = cs.cards[st.cardId] as Card;
          if (TABLE.card[col](phase, s)) {
            allowed.push(JSON.stringify(card));
            shown.add(card.id);
          }
          if (TABLE.options[col](phase, s)) allowed.push(JSON.stringify(card.options));
          if (TABLE.bound[col](phase, s)) allowed.push(JSON.stringify(boundOf(cs, card)));
        }
        const sceneRule =
          vt === "gm" ? TABLE.scenes.gm : vt === null ? TABLE.scenes.unassigned : TABLE.scenes.member;
        if (sceneRule(phase)) allowed.push(JSON.stringify(cs.scenes[s.mode === "scenario" ? "T" : "K"]));
        const allowedText = allowed.join("\n");

        // 見せていないカード（引き直し前のカード・山の残り・相手や他グループのカード）の中身
        for (const card of Object.values(cs.cards)) {
          if (shown.has(card.id)) continue;
          for (const text of [card.odai, card.purpose, card.scene, card.memo, card.form]) {
            if (allowedText.includes(text)) continue; // 見てよいものの中に同じ文字列がある（選択肢・場面リストなど）
            expect(json.includes(text), `${vt} に ${card.id} の「${text.slice(0, 20)}」が漏れている`).toBe(false);
          }
        }
        // トークンのハッシュは誰にも送らない
        expect(json).not.toContain("tokenHash");
        expect(json).not.toContain("token-hash-");
        expect(json).not.toContain("gm-hash");
      }
    });
  }
});

describe("view の中身", () => {
  it("お題（odai）は見てよいカード以外に一度も出てこない（引き直し前のカードを含む）", () => {
    const r = roomAt({ ...DEFAULT_SETTINGS, groups: 2 }, "card", 5);
    const deck = deckOf(r, "G1-A");
    expect(r.teams["G1-A"]!.cardId).toBe(deck[2]);
    const v = viewFor(r, { kind: "member", memberId: firstMemberOf(r, "G1-A") }, cs)!;
    const json = JSON.stringify(v);
    expect(json).toContain(cs.cards[deck[2]!]!.odai);
    expect(json).not.toContain(cs.cards[deck[0]!]!.odai);
    expect(json).not.toContain(cs.cards[deck[1]!]!.odai);
    expect(json).not.toContain(`"${deck[0]}"`);
  });

  it("参加者の view にはメンバーIDを入れず、GM の view には入れる", () => {
    const r = roomAt({ ...DEFAULT_SETTINGS }, "card", 1);
    const mv = viewFor(r, { kind: "member", memberId: "m1" }, cs) as MemberView;
    const gv = viewFor(r, { kind: "gm" }, cs) as GMView;
    expect(mv.teams.flatMap((t) => t.members).every((m) => m.id === undefined)).toBe(true);
    expect(mv.unassigned.every((m) => m.id === undefined)).toBe(true);
    expect(gv.teams.flatMap((t) => t.members).every((m) => typeof m.id === "string")).toBe(true);
    expect(mv.me).toEqual({ id: "m1", nickname: "参加者1", team: "G1-A" });
  });

  it("GM の view だけに出来事の記録と次の設定が入る", () => {
    const r = roomAt({ ...DEFAULT_SETTINGS }, "card", 1);
    const mv = viewFor(r, { kind: "member", memberId: "m1" }, cs) as MemberView & Partial<GMView>;
    const gv = viewFor(r, { kind: "gm" }, cs) as GMView;
    expect(mv.log).toBeUndefined();
    expect(mv.nextSettings).toBeUndefined();
    expect(gv.log.length).toBeGreaterThan(0);
    expect(gv.nextSettings).toEqual(r.settings);
  });

  it("集合では、選べるチームの一覧（人数）と未選択のメンバーが見える", () => {
    const r = roomWithMembers({ groups: 2 }, { perTeam: 1, unassigned: 2 });
    const v = viewFor(r, { kind: "member", memberId: "m5" }, cs)!;
    expect(v.teams.map((t) => [t.id, t.members.length])).toEqual([
      ["G1-A", 1],
      ["G1-B", 1],
      ["G2-A", 1],
      ["G2-B", 1],
    ]);
    expect(v.unassigned.map((m) => m.nickname)).toEqual(["参加者5", "参加者6"]);
    expect(v.me.team).toBeNull();
  });

  it("引き直しの上限：個別カード方式は2、共通カード方式は0", () => {
    const a = viewFor(roomAt({ ...DEFAULT_SETTINGS }, "card", 1), { kind: "gm" }, cs)!;
    const b = viewFor(roomAt({ ...DEFAULT_SETTINGS, dist: "common" }, "card", 1), { kind: "gm" }, cs)!;
    expect(a.redrawLimit).toBe(2);
    expect(b.redrawLimit).toBe(0);
  });

  it("いないメンバーには view を作らない", () => {
    expect(viewFor(roomWithMembers(), { kind: "member", memberId: "nobody" }, cs)).toBeNull();
  });

  it("view を書き換えても部屋は変わらない", () => {
    const r = roomAt({ ...DEFAULT_SETTINGS }, "review", 1);
    const snap = structuredClone(r);
    const v = viewFor(r, { kind: "gm" }, cs)!;
    v.teams[0]!.card!.options.push("x");
    v.settings.groups = 9;
    expect(r).toEqual(snap);
    expect(cs.cards[r.teams["G1-A"]!.cardId]!.options).not.toContain("x");
  });
});
