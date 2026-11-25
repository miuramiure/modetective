/** 結合テストの下準備：サーバーを空いているポートで立て、socket.io-client でつなぐ */
import { fileURLToPath } from "node:url";
import { io as connect, type Socket } from "socket.io-client";
import type { GMView, MemberView, View } from "@mdt/core";
import { createApp, SOCKET_PATH, type Ack, type App } from "../app.js";
import { loadCardsets } from "../cardsets.js";
import type { Config } from "../config.js";
import { hashPasswordSync } from "../secrets.js";
import { MemoryStore, type RoomStore } from "../store.js";

export const ORIGIN = "http://localhost:5173";
export const GM_PASS = "ルーペとワトソン";
const PASS_HASH = hashPasswordSync(GM_PASS);
const cardsets = loadCardsets(
  fileURLToPath(new URL("../../../../data/cards", import.meta.url)),
  "v0.4",
);

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    host: "127.0.0.1",
    port: 0,
    gmPassHash: PASS_HASH,
    allowedOrigins: [ORIGIN],
    roomsFile: null,
    cardsDir: "",
    defaultCardset: "v0.4",
    version: "test",
    trustProxy: false,
    ...over,
  };
}

export interface Running {
  app: App;
  url: string;
  clock: { t: number };
  close(): Promise<void>;
}

export async function start(
  opts: {
    store?: RoomStore;
    config?: Partial<Config>;
    clock?: { t: number };
  } = {},
): Promise<Running> {
  const clock = opts.clock ?? { t: 1_000_000 };
  const app = await createApp({
    config: testConfig(opts.config),
    cardsets,
    store: opts.store ?? new MemoryStore(),
    now: () => clock.t,
    log: () => undefined,
    saveDelayMs: 10,
  });
  const port = await app.listen(0);
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    clock,
    close: () => app.close(),
  };
}

/** view を覚えておくクライアント */
export class Client {
  readonly socket: Socket;
  views: View[] = [];
  events: string[] = [];
  private waiters: {
    pred: (v: View) => boolean;
    resolve: (v: View) => void;
  }[] = [];

  constructor(url: string, origin: string | null = ORIGIN) {
    this.socket = connect(url, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      ...(origin ? { extraHeaders: { origin } } : {}),
    });
    this.socket.on("view", (v: View) => {
      this.views.push(v);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(v)) return true;
        w.resolve(v);
        return false;
      });
    });
    for (const e of ["session:replaced", "room:closed"])
      this.socket.on(e, () => this.events.push(e));
  }

  get view(): View | undefined {
    return this.views.at(-1);
  }
  get member(): MemberView {
    const v = this.view;
    if (v?.role !== "member") throw new Error("参加者の view がありません");
    return v;
  }
  get gm(): GMView {
    const v = this.view;
    if (v?.role !== "gm") throw new Error("GM の view がありません");
    return v;
  }

  call(event: string, payload: unknown = {}): Promise<Ack> {
    return this.socket
      .timeout(5000)
      .emitWithAck(event, payload) as Promise<Ack>;
  }

  /** 条件に合う view が届くまで待つ（最新の view がすでに合えばそれを返す） */
  until(pred: (v: View) => boolean, ms = 3000): Promise<View> {
    const last = this.view;
    if (last && pred(last)) return Promise.resolve(last);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("view が届きませんでした")),
        ms,
      );
      this.waiters.push({
        pred,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
      });
    });
  }

  waitEvent(name: string, ms = 3000): Promise<void> {
    if (this.events.includes(name)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${name} が届きませんでした`)),
        ms,
      );
      this.socket.once(name, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  connected(): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.once("connect", () => resolve());
      this.socket.once("connect_error", reject);
    });
  }

  close(): void {
    this.socket.disconnect();
  }
}

export function expectOk(a: Ack): Extract<Ack, { ok: true }> {
  if (!a.ok) throw new Error(`失敗しました：${a.code} ${a.message}`);
  return a;
}
