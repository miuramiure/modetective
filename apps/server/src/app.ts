/**
 * HTTP（health）と Socket.IO（部屋・同期）。基本設計 5・6 章。
 * 状態を変えるのは core の関数だけ。各人には viewFor の結果だけを送る。
 */
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from "node:http";
import { randomInt, timingSafeEqual } from "node:crypto";
import { Server, type Socket } from "socket.io";
import {
  chooseTeam,
  confirm,
  createRoom,
  findMemberByToken,
  join,
  moveMember,
  nextSet,
  redraw,
  setGmToken,
  setPhase,
  updateSettings,
  viewFor,
  type Cardset,
  type Phase,
  type Rand,
  type Result,
  type Room,
  type View,
  type Viewer,
} from "@mdt/core";
import type { Config } from "./config.js";
import { RateLimiter } from "./rateLimit.js";
import { RoomManager } from "./rooms.js";
import { hashToken, newId, newToken, verifyPassword } from "./secrets.js";
import type { RoomStore } from "./store.js";

export const BASE_PATH = "/modetective";
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;
export const HEALTH_PATH = `${BASE_PATH}/api/health`;
export const MAX_MEMBERS_PER_ROOM = 100;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export type Ack =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: string; message: string };

type Session =
  | { code: string; role: "gm" }
  | { code: string; role: "member"; memberId: string };

interface SocketData {
  session: Session | undefined;
}
/** サーバー→クライアント */
export interface ServerToClient {
  view: (view: View) => void;
  "session:replaced": () => void;
  "room:closed": () => void;
}
/** クライアント→サーバー（どれも payload と ack を受け取る） */
type ClientToServer = Record<
  string,
  (payload: unknown, ack?: (a: Ack) => void) => void
>;
type MdtSocket = Socket<
  ClientToServer,
  ServerToClient,
  Record<string, never>,
  SocketData
>;

interface Slot {
  gm: MdtSocket | null;
  members: Map<string, MdtSocket>;
}

export interface AppDeps {
  config: Config;
  cardsets: Map<string, Cardset>;
  store: RoomStore;
  now?: () => number;
  rand?: Rand;
  log?: (msg: string) => void;
  saveDelayMs?: number;
}

export interface App {
  httpServer: HttpServer;
  io: Server;
  manager: RoomManager;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

const fail = (code: string, message: string): Ack => ({
  ok: false,
  code,
  message,
});
const BAD_REQUEST_MESSAGE = "送られた内容が正しくありません。";
const BAD_REQUEST = fail("bad_request", BAD_REQUEST_MESSAGE);
/** core の Result と同じ形の失敗（core の操作の代わりに返す） */
const badRequest = (): Result => ({
  ok: false,
  code: "bad_request" as never,
  message: BAD_REQUEST_MESSAGE,
});

function obj(p: unknown): Record<string, unknown> {
  return typeof p === "object" && p !== null
    ? (p as Record<string, unknown>)
    : {};
}
const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.length <= max ? v : null;

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** core の Result を ack にする（部屋は返さない） */
function toAck(r: Result | null): Ack {
  if (!r)
    return fail(
      "room_not_found",
      "部屋が見つかりません。期限が切れた可能性があります。",
    );
  return r.ok ? { ok: true } : r;
}

export async function createApp(deps: AppDeps): Promise<App> {
  const { config } = deps;
  const now = deps.now ?? Date.now;
  const rand = deps.rand ?? (() => randomInt(0, 2 ** 32) / 2 ** 32);
  const log = deps.log ?? ((m: string) => console.log(`[modetective] ${m}`));
  const slots = new Map<string, Slot>();
  const passLimiter = new RateLimiter(5, 10 * 60 * 1000, now); // 合言葉の失敗：10分間5回まで
  const createLimiter = new RateLimiter(20, 60 * 60 * 1000, now); // 部屋の作成：1時間20回まで

  const manager = new RoomManager({
    store: deps.store,
    cardsets: deps.cardsets,
    now,
    rand,
    log,
    ...(deps.saveDelayMs !== undefined
      ? { saveDelayMs: deps.saveDelayMs }
      : {}),
    onChange: (code) => broadcast(code),
    onClosed: (code) => closeRoom(code),
  });
  await manager.init();

  // ===== HTTP =====
  const httpServer = createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && url === HEALTH_PATH) {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          ok: true,
          rooms: manager.size,
          members: manager.memberCount,
          version: config.version,
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  const io = new Server<
    ClientToServer,
    ServerToClient,
    Record<string, never>,
    SocketData
  >(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    cors: { origin: config.allowedOrigins },
    // 決めた Origin からの接続だけを受け付ける（ブラウザ以外の Origin なしも断る）
    allowRequest: (req: IncomingMessage, cb) => {
      const origin = req.headers.origin;
      cb(
        null,
        typeof origin === "string" && config.allowedOrigins.includes(origin),
      );
    },
  });

  // ===== 接続の管理 =====
  const slotOf = (code: string): Slot => {
    let s = slots.get(code);
    if (!s) {
      s = { gm: null, members: new Map() };
      slots.set(code, s);
    }
    return s;
  };

  const viewerOf = (s: Session): Viewer =>
    s.role === "gm" ? { kind: "gm" } : { kind: "member", memberId: s.memberId };

  function sendView(socket: MdtSocket): void {
    const s = socket.data.session;
    const room = s && manager.get(s.code);
    if (!s || !room) return;
    const view = viewFor(room, viewerOf(s), manager.cardsetOf(room));
    if (view) socket.emit("view", view);
  }

  function broadcast(code: string): void {
    const slot = slots.get(code);
    if (!slot) return;
    if (slot.gm) sendView(slot.gm);
    for (const s of slot.members.values()) sendView(s);
  }

  function closeRoom(code: string): void {
    const slot = slots.get(code);
    slots.delete(code);
    if (!slot) return;
    for (const s of [slot.gm, ...slot.members.values()]) {
      if (!s) continue;
      s.data.session = undefined;
      s.emit("room:closed");
      s.disconnect(true);
    }
  }

  /** この接続を部屋から外す */
  function detach(socket: MdtSocket): void {
    const s = socket.data.session;
    if (!s) return;
    socket.data.session = undefined;
    const slot = slots.get(s.code);
    if (s.role === "gm") {
      if (slot?.gm === socket) slot.gm = null;
    } else if (slot?.members.get(s.memberId) === socket) {
      slot.members.delete(s.memberId);
      manager.setConnected(s.code, s.memberId, false);
    }
  }

  /** この接続を部屋につなぐ。同じ人の古い接続は session:replaced で切る */
  function attach(socket: MdtSocket, session: Session): void {
    detach(socket);
    const slot = slotOf(session.code);
    const old =
      session.role === "gm" ? slot.gm : slot.members.get(session.memberId);
    if (old && old !== socket) {
      old.data.session = undefined;
      old.emit("session:replaced");
      old.disconnect(true);
    }
    if (session.role === "gm") slot.gm = socket;
    else slot.members.set(session.memberId, socket);
    socket.data.session = session;
    if (session.role === "member")
      manager.setConnected(session.code, session.memberId, true);
    sendView(socket);
  }

  function ipOf(socket: MdtSocket): string {
    if (config.trustProxy) {
      const xff = socket.handshake.headers["x-forwarded-for"];
      const last = (Array.isArray(xff) ? xff.join(",") : (xff ?? ""))
        .split(",")
        .pop()
        ?.trim();
      if (last) return last;
    }
    return socket.handshake.address;
  }

  async function checkPass(
    socket: MdtSocket,
    pass: unknown,
  ): Promise<Ack | null> {
    const ip = ipOf(socket);
    if (passLimiter.isBlocked(ip)) {
      return fail(
        "too_many",
        "GM合言葉の入力が続けてまちがえられました。10分ほどしてからやり直してください。",
      );
    }
    if (await verifyPassword(pass, config.gmPassHash)) return null;
    passLimiter.hit(ip);
    return fail("bad_pass", "GM合言葉がちがいます。");
  }

  const requireGM = (socket: MdtSocket): { code: string } | null => {
    const s = socket.data.session;
    return s?.role === "gm" && manager.get(s.code) ? { code: s.code } : null;
  };
  const requireMember = (
    socket: MdtSocket,
  ): { code: string; memberId: string } | null => {
    const s = socket.data.session;
    return s?.role === "member" && manager.get(s.code)
      ? { code: s.code, memberId: s.memberId }
      : null;
  };
  const NOT_GM = fail("unauthorized", "GMとして入っていません。");
  const NOT_MEMBER = fail("not_joined", "部屋に参加していません。");

  // ===== 操作 =====
  io.on("connection", (socket: MdtSocket) => {
    const on = (
      event: string,
      handler: (p: Record<string, unknown>) => Ack | Promise<Ack>,
    ) => {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === "function" ? ack : () => undefined;
        try {
          reply(await handler(obj(payload)));
        } catch (e) {
          log(
            `${event} でエラー：${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
          );
          reply(fail("internal", "サーバーでエラーが起きました。"));
        }
      });
    };

    socket.on("disconnect", () => detach(socket));

    // --- GM ---
    on("gm:create", async (p) => {
      const ip = ipOf(socket);
      if (createLimiter.isBlocked(ip)) {
        return fail(
          "too_many",
          "部屋を作る回数が多すぎます。しばらくしてからやり直してください。",
        );
      }
      const bad = await checkPass(socket, p.pass);
      if (bad) return bad;
      if (manager.isFull())
        return fail(
          "room_limit",
          "部屋の数が上限に達しています。しばらくしてからやり直してください。",
        );
      const gmToken = newToken();
      const r = createRoom({
        code: manager.newCode(),
        gmTokenHash: hashToken(gmToken),
        settings: p.settings,
        cardset: config.defaultCardset,
        now: now(),
      });
      if (!r.ok) return r;
      createLimiter.hit(ip);
      manager.add(r.room);
      attach(socket, { code: r.room.code, role: "gm" });
      log(`部屋 ${r.room.code} を作りました`);
      return { ok: true, code: r.room.code, gmToken };
    });

    on("gm:login", async (p) => {
      const code = str(p.code, 20)?.toUpperCase();
      if (!code) return BAD_REQUEST;
      const bad = await checkPass(socket, p.pass);
      if (bad) return bad;
      if (!manager.get(code)) return toAck(null);
      const gmToken = newToken();
      manager.apply(code, (room) =>
        setGmToken(room, hashToken(gmToken), now()),
      );
      attach(socket, { code, role: "gm" });
      return { ok: true, code, gmToken };
    });

    on("gm:resume", (p) => {
      const code = str(p.code, 20)?.toUpperCase();
      const token = str(p.gmToken);
      if (!code || !token) return BAD_REQUEST;
      const room = manager.get(code);
      if (!room) return toAck(null);
      if (!sameHash(hashToken(token), room.gm.tokenHash)) {
        return fail(
          "unauthorized",
          "GMとして入り直せませんでした。部屋コードとGM合言葉で入ってください。",
        );
      }
      attach(socket, { code, role: "gm" });
      return { ok: true, code };
    });

    const gmOp = (
      event: string,
      op: (room: Room, cs: Cardset, p: Record<string, unknown>) => Result,
    ) =>
      on(event, (p) => {
        const g = requireGM(socket);
        if (!g) return NOT_GM;
        return toAck(manager.apply(g.code, (room, cs) => op(room, cs, p)));
      });

    gmOp("gm:updateSettings", (room, _cs, p) =>
      updateSettings(room, p.settings, now()),
    );
    gmOp("gm:setPhase", (room, cs, p) =>
      setPhase(room, p.to as Phase, { cardset: cs, rand, now: now() }),
    );
    gmOp("gm:nextSet", (room, cs) =>
      nextSet(room, { cardset: cs, rand, now: now() }),
    );
    gmOp("gm:moveMember", (room, _cs, p) => {
      const memberId = str(p.memberId, 50);
      const team = p.team === null ? null : str(p.team, 10);
      if (!memberId || (p.team !== null && team === null)) return badRequest();
      return moveMember(room, memberId, team, now());
    });

    // --- 参加者 ---
    on("member:join", (p) => {
      const code = str(p.code, 20)?.toUpperCase();
      if (!code) return BAD_REQUEST;
      const room = manager.get(code);
      if (!room) return toAck(null);
      if (room.members.length >= MAX_MEMBERS_PER_ROOM) {
        return fail("member_limit", "この部屋の参加者が上限に達しています。");
      }
      const memberToken = newToken();
      const memberId = newId();
      const r = manager.apply(code, (rm) =>
        join(
          rm,
          {
            id: memberId,
            tokenHash: hashToken(memberToken),
            nickname: p.nickname,
          },
          now(),
        ),
      );
      if (!r || !r.ok) return toAck(r);
      attach(socket, { code, role: "member", memberId });
      return {
        ok: true,
        code,
        memberToken,
        memberId,
        nickname: r.member.nickname,
      };
    });

    on("member:resume", (p) => {
      const code = str(p.code, 20)?.toUpperCase();
      const token = str(p.memberToken);
      if (!code || !token) return BAD_REQUEST;
      const room = manager.get(code);
      if (!room) return toAck(null);
      const m = findMemberByToken(room, hashToken(token));
      if (!m)
        return fail(
          "unauthorized",
          "参加の記録が見つかりません。もう一度ニックネームを入れてください。",
        );
      attach(socket, { code, role: "member", memberId: m.id });
      return { ok: true, code, memberId: m.id, nickname: m.nickname };
    });

    const memberOp = (
      event: string,
      op: (room: Room, memberId: string, p: Record<string, unknown>) => Result,
    ) =>
      on(event, (p) => {
        const m = requireMember(socket);
        if (!m) return NOT_MEMBER;
        return toAck(manager.apply(m.code, (room) => op(room, m.memberId, p)));
      });

    memberOp("member:chooseTeam", (room, id, p) =>
      chooseTeam(
        room,
        id,
        p.team === null ? null : (str(p.team, 10) ?? "?"),
        now(),
      ),
    );
    memberOp("team:redraw", (room, id, p) =>
      redraw(room, id, { setNo: p.setNo, cardId: p.cardId }, now()),
    );
    memberOp("team:confirm", (room, id, p) =>
      confirm(room, id, { setNo: p.setNo, cardId: p.cardId }, now()),
    );
  });

  const sweepTimer = setInterval(() => {
    manager.sweep();
    passLimiter.prune();
    createLimiter.prune();
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  return {
    httpServer,
    io,
    manager,
    listen: (port = config.port) =>
      new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, config.host, () => {
          const addr = httpServer.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      }),
    close: async () => {
      clearInterval(sweepTimer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await manager.flush();
    },
  };
}
