/**
 * サーバーの結合テスト（基本設計 10 章）：GM1＋参加者4人で
 * 作成→参加→チーム選択→引き直しがチーム全員に届く→フェーズ切り替え→見せ分け→再起動後に復元
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  ROOM_TTL_MS,
  type MemberView,
  type Settings,
} from "@mdt/core";
import { HEALTH_PATH } from "./app.js";
import { FileStore } from "./store.js";
import {
  Client,
  GM_PASS,
  expectOk,
  start,
  type Running,
} from "./test/harness.js";

const settings = (s: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...s,
});

let cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function boot(opts: Parameters<typeof start>[0] = {}): Promise<Running> {
  const s = await start(opts);
  cleanups.push(() => s.close());
  return s;
}
function client(s: Running, origin?: string | null): Client {
  const c = new Client(s.url, origin);
  cleanups.push(() => c.close());
  return c;
}

/** GM が部屋を作り、4人が G1-A・G1-B に2人ずつ入る */
async function setup(s: Running, st: Partial<Settings> = {}) {
  const gm = client(s);
  const created = expectOk(
    await gm.call("gm:create", { pass: GM_PASS, settings: settings(st) }),
  );
  const code = created.code as string;
  const names = ["佐藤", "鈴木", "高橋", "田中"];
  const teams = ["G1-A", "G1-A", "G1-B", "G1-B"];
  const members: { c: Client; token: string; id: string }[] = [];
  for (const [i, name] of names.entries()) {
    const c = client(s);
    const j = expectOk(
      await c.call("member:join", { code: code.toLowerCase(), nickname: name }),
    );
    expectOk(await c.call("member:chooseTeam", { team: teams[i] }));
    members.push({
      c,
      token: j.memberToken as string,
      id: j.memberId as string,
    });
  }
  await gm.until((v) => v.teams.every((t) => t.members.length === 2));
  return { gm, code, gmToken: created.gmToken as string, members };
}

describe("1セットの流れ", () => {
  it("作成→参加→チーム選択→カード提示→引き直しがチーム全員に届く→フェーズが全員同時に切り替わる→見せ分け", async () => {
    const s = await boot();
    const { gm, code, members } = await setup(s);
    const [a1, a2, b1, b2] = members.map((m) => m.c) as [
      Client,
      Client,
      Client,
      Client,
    ];
    expect(code).toMatch(/^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/);
    expect(a1.member.me).toMatchObject({ nickname: "佐藤", team: "G1-A" });

    // 集合：カードはまだない
    expect(gm.gm.phase).toBe("lobby");
    expect(a1.member.teams.every((t) => t.card === undefined)).toBe(true);

    // カードを配る
    expectOk(await gm.call("gm:setPhase", { to: "card" }));
    const all = [gm, a1, a2, b1, b2];
    await Promise.all(all.map((c) => c.until((v) => v.phase === "card")));
    const own = (c: Client) =>
      c.member.teams.find((t) => t.id === c.member.me.team)!;
    const first = own(a1).card!;
    expect(own(a2).card).toEqual(first);
    // B チームには A のカードを送らない
    expect(JSON.stringify(b1.view)).not.toContain(first.odai);

    // A の1人が引き直すと、A の全員に新しいカードが届く
    expectOk(await a1.call("team:redraw", { setNo: 1, cardId: first.id }));
    const next = (await a2.until(
      (v) => (v as MemberView).teams[0]!.redrawsUsed === 1,
    )) as MemberView;
    expect(next.teams[0]!.card!.id).not.toBe(first.id);
    // 同じ古い画面からの二重押しは弾く
    expect(
      await a2.call("team:redraw", { setNo: 1, cardId: first.id }),
    ).toMatchObject({ ok: false, code: "stale" });
    // 確定は誰が押してもよい
    expectOk(
      await a2.call("team:confirm", {
        setNo: 1,
        cardId: next.teams[0]!.card!.id,
      }),
    );
    await gm.until((v) => v.teams[0]!.confirmedBy === "鈴木");
    expect(
      gm.gm.log.some((l) => l.text.includes("佐藤さんが引き直しました")),
    ).toBe(true);

    // 調査へ：B は自動確定（K4）、全員の画面が切り替わる
    expectOk(await gm.call("gm:setPhase", { to: "investigate" }));
    await Promise.all(
      all.map((c) => c.until((v) => v.phase === "investigate")),
    );
    expect(gm.gm.teams[1]).toMatchObject({
      confirmed: true,
      confirmedBy: null,
    });

    // 推理：相手の目的の選択肢だけが見える。場面の選択肢リストも届く
    expectOk(await gm.call("gm:setPhase", { to: "deduce" }));
    const bView = (await b1.until((v) => v.phase === "deduce")) as MemberView;
    const aCard = gm.gm.teams[0]!.card!;
    expect(bView.teams[0]!.card).toBeUndefined();
    expect(bView.teams[0]!.options).toEqual(aCard.options);
    expect(bView.scenes).toHaveLength(56);
    expect(JSON.stringify(bView)).not.toContain(aCard.odai);

    // 解決編：相手のカードが公開される
    expectOk(await gm.call("gm:setPhase", { to: "reveal" }));
    const bReveal = (await b1.until((v) => v.phase === "reveal")) as MemberView;
    expect(bReveal.teams[0]!.card).toEqual(aCard);

    // 振り返り→次のセット（K5）
    expectOk(await gm.call("gm:setPhase", { to: "review" }));
    expectOk(await gm.call("gm:nextSet"));
    const set2 = (await a1.until((v) => v.setNo === 2)) as MemberView;
    expect(set2).toMatchObject({ phase: "card", me: { team: "G1-A" } });
  });

  it("参加者は GM の操作ができない。部屋に入っていなければ操作できない", async () => {
    const s = await boot();
    const { members } = await setup(s);
    const m = members[0]!.c;
    expect(await m.call("gm:setPhase", { to: "card" })).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
    const stranger = client(s);
    expect(
      await stranger.call("team:redraw", { setNo: 1, cardId: "T01" }),
    ).toMatchObject({ code: "not_joined" });
    expect(
      await stranger.call("member:join", { code: "ZZZZZZ", nickname: "x" }),
    ).toMatchObject({
      code: "room_not_found",
    });
    expect(await stranger.call("member:join", "おかしな内容")).toMatchObject({
      code: "bad_request",
    });
  });

  it("GM はメンバーをほかのチームへ移せる", async () => {
    const s = await boot();
    const { gm, members } = await setup(s);
    expectOk(
      await gm.call("gm:moveMember", {
        memberId: members[0]!.id,
        team: "G1-B",
      }),
    );
    await members[0]!.c.until((v) => (v as MemberView).me.team === "G1-B");
    expect(
      await gm.call("gm:moveMember", { memberId: 3, team: "G1-B" }),
    ).toMatchObject({ code: "bad_request" });
  });

  it("設定を変えられる（集合のとき）", async () => {
    const s = await boot();
    const { gm } = await setup(s);
    expectOk(
      await gm.call("gm:updateSettings", {
        settings: settings({ groups: 3, mode: "kikikomi" }),
      }),
    );
    await gm.until((v) => v.groups === 3);
    expect(gm.gm.nextSettings.mode).toBe("kikikomi");
    expect(
      await gm.call("gm:updateSettings", { settings: { groups: 3 } }),
    ).toMatchObject({ code: "bad_settings" });
  });
});

describe("再接続と復元", () => {
  it("同じトークンで別の接続が来たら、古い接続に session:replaced を送る", async () => {
    const s = await boot();
    const { gm, code, members } = await setup(s);
    const again = client(s);
    expectOk(
      await again.call("member:resume", {
        code,
        memberToken: members[0]!.token,
      }),
    );
    await members[0]!.c.waitEvent("session:replaced");
    expect((again.view as MemberView).me).toMatchObject({
      nickname: "佐藤",
      team: "G1-A",
    });
    // 新しい接続が生きているので、接続中のまま
    expect(
      gm.gm.teams[0]!.members.find((m) => m.nickname === "佐藤")?.connected,
    ).toBe(true);
  });

  it("切断すると GM の画面で未接続になり、入り直すと戻る", async () => {
    const s = await boot();
    const { gm, code, members } = await setup(s);
    members[2]!.c.close();
    await gm.until((v) =>
      v.teams[1]!.members.some((m) => m.nickname === "高橋" && !m.connected),
    );
    const back = client(s);
    expectOk(
      await back.call("member:resume", {
        code,
        memberToken: members[2]!.token,
      }),
    );
    await gm.until((v) => v.teams[1]!.members.every((m) => m.connected));
    expect(
      await back.call("member:resume", { code, memberToken: "ちがう" }),
    ).toMatchObject({ code: "unauthorized" });
  });

  it("サーバーを再起動しても部屋が戻り、同じトークンで同じチーム・同じカードに戻る", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "mdt-")), "rooms.json");
    const clock = { t: 5_000_000 };
    const s1 = await start({ store: new FileStore(file), clock });
    const { gm, code, gmToken, members } = await setup(s1);
    expectOk(await gm.call("gm:setPhase", { to: "card" }));
    const before = (await members[0]!.c.until(
      (v) => v.phase === "card",
    )) as MemberView;
    const card = before.teams[0]!.card!;
    for (const m of members) m.c.close();
    gm.close();
    await s1.close(); // 保存してから止まる

    const s2 = await boot({ store: new FileStore(file), clock });
    expect(s2.app.manager.size).toBe(1);
    const m = client(s2);
    expectOk(
      await m.call("member:resume", { code, memberToken: members[0]!.token }),
    );
    const after = m.member;
    expect(after).toMatchObject({
      phase: "card",
      me: { nickname: "佐藤", team: "G1-A" },
    });
    expect(after.teams[0]!.card).toEqual(card);
    // 再起動直後はほかのメンバーは未接続
    expect(after.teams[1]!.members.every((x) => !x.connected)).toBe(true);
    const g = client(s2);
    expectOk(await g.call("gm:resume", { code, gmToken }));
    expect(g.gm.teams[0]!.card).toEqual(card);
  });
});

describe("GM合言葉", () => {
  it("合言葉がちがえば部屋を作れない。全角・半角や前後の空白の違いは気にしない", async () => {
    const s = await boot();
    const gm = client(s);
    expect(
      await gm.call("gm:create", { pass: "ちがう", settings: settings() }),
    ).toMatchObject({ code: "bad_pass" });
    expectOk(
      await gm.call("gm:create", {
        pass: ` ${GM_PASS}${String.fromCharCode(0x3000)}`,
        settings: settings(),
      }),
    );
  });

  it("失敗は IP ごとに10分間5回まで。それ以上は正しい合言葉でも断り、10分たてば戻る", async () => {
    const s = await boot();
    const gm = client(s);
    for (let i = 0; i < 5; i++) {
      expect(
        await gm.call("gm:create", { pass: "x", settings: settings() }),
      ).toMatchObject({ code: "bad_pass" });
    }
    expect(
      await gm.call("gm:create", { pass: GM_PASS, settings: settings() }),
    ).toMatchObject({ code: "too_many" });
    s.clock.t += 10 * 60 * 1000;
    expectOk(
      await gm.call("gm:create", { pass: GM_PASS, settings: settings() }),
    );
  });

  it("部屋の作成は1時間20回まで", async () => {
    const s = await boot();
    const gm = client(s);
    for (let i = 0; i < 20; i++)
      expectOk(
        await gm.call("gm:create", { pass: GM_PASS, settings: settings() }),
      );
    expect(
      await gm.call("gm:create", { pass: GM_PASS, settings: settings() }),
    ).toMatchObject({ code: "too_many" });
  });

  it("Caddy の後ろでは X-Forwarded-For の最後の値を IP とみなす", async () => {
    const s = await boot({ config: { trustProxy: true } });
    const asIp = (ip: string) => {
      const c = new Client(s.url);
      cleanups.push(() => c.close());
      c.socket.io.opts.extraHeaders = {
        origin: "http://localhost:5173",
        "x-forwarded-for": `9.9.9.9, ${ip}`,
      };
      c.socket.disconnect().connect();
      return c;
    };
    const a = asIp("10.0.0.1");
    for (let i = 0; i < 5; i++)
      await a.call("gm:create", { pass: "x", settings: settings() });
    expect(
      await a.call("gm:create", { pass: GM_PASS, settings: settings() }),
    ).toMatchObject({ code: "too_many" });
    const b = asIp("10.0.0.2");
    expectOk(
      await b.call("gm:create", { pass: GM_PASS, settings: settings() }),
    );
  });

  it("別の端末から「部屋コード＋GM合言葉」で入り直すと、前の GM の接続は切れる", async () => {
    const s = await boot();
    const { gm, code, gmToken } = await setup(s);
    const other = client(s);
    expect(await other.call("gm:login", { code, pass: "x" })).toMatchObject({
      code: "bad_pass",
    });
    const login = expectOk(
      await other.call("gm:login", { code, pass: GM_PASS }),
    );
    await gm.waitEvent("session:replaced");
    expect(other.gm.teams[0]!.members).toHaveLength(2);
    // 古いトークンは使えなくなる。新しいトークンで入り直せる
    const third = client(s);
    expect(await third.call("gm:resume", { code, gmToken })).toMatchObject({
      code: "unauthorized",
    });
    expectOk(await third.call("gm:resume", { code, gmToken: login.gmToken }));
  });
});

describe("接続の受け付け・health・期限", () => {
  it("決めた Origin 以外からの接続は受け付けない", async () => {
    const s = await boot();
    await expect(
      client(s, "https://evil.example").connected(),
    ).rejects.toThrow();
    await expect(client(s, null).connected()).rejects.toThrow();
    await expect(client(s).connected()).resolves.toBeUndefined();
  });

  it("health は部屋数・人数・版を返す", async () => {
    const s = await boot();
    await setup(s);
    const res = await fetch(s.url + HEALTH_PATH);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      rooms: 1,
      members: 4,
      version: "test",
    });
    expect((await fetch(s.url + "/modetective/other")).status).toBe(404);
  });

  it("最後の操作から48時間で部屋を消し、全員に room:closed を送る", async () => {
    const s = await boot();
    const { gm, code, members } = await setup(s);
    s.clock.t += ROOM_TTL_MS;
    s.app.manager.sweep();
    await Promise.all([
      gm.waitEvent("room:closed"),
      members[0]!.c.waitEvent("room:closed"),
    ]);
    expect(s.app.manager.get(code)).toBeUndefined();
    const again = client(s);
    expect(
      await again.call("member:resume", {
        code,
        memberToken: members[0]!.token,
      }),
    ).toMatchObject({
      code: "room_not_found",
    });
  });
});
