/**
 * サーバーとの通信。画面はサーバーから届いた view を表示するだけ（CLAUDE.md 設計の約束2）。
 * 接続が切れても自動でつなぎ直し、保存したトークンで入り直す。
 */
import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { View } from "@mdt/core";
import { storage } from "./storage";

export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV
    ? `http://${location.hostname}:3102`
    : "https://games-api.m-miura.jp");
export const SOCKET_PATH = "/modetective/socket.io";

export type Ack =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: string; message: string };

export type Session =
  | { kind: "gm"; code: string; token: string }
  | { kind: "member"; code: string; token: string };

export interface NetState {
  status: "connecting" | "connected" | "disconnected";
  view: View | null;
  /** 別の画面で同じ人が入った／部屋が消えた */
  notice: "replaced" | "closed" | null;
  /** 入り直せなかったときの理由 */
  resumeError: { code: string; message: string } | null;
}

class Net {
  private socket: Socket;
  private session: Session | null = null;
  private listeners = new Set<() => void>();
  state: NetState = {
    status: "connecting",
    view: null,
    notice: null,
    resumeError: null,
  };

  constructor() {
    this.socket = io(SERVER_URL, {
      path: SOCKET_PATH,
      transports: ["websocket", "polling"],
    });
    this.socket.on("connect", () => {
      this.set({ status: "connected" });
      if (this.session && !this.state.notice) void this.resume();
    });
    this.socket.on("disconnect", () => this.set({ status: "disconnected" }));
    this.socket.io.on("reconnect_attempt", () =>
      this.set({ status: "connecting" }),
    );
    // サーバーはこの接続がつながっている人の view だけを送ってくる
    this.socket.on("view", (view: View) => this.set({ view }));
    this.socket.on("session:replaced", () => this.set({ notice: "replaced" }));
    this.socket.on("room:closed", () => {
      if (this.session) storage.forget(this.session);
      this.set({ notice: "closed", view: null });
    });
  }

  private set(patch: Partial<NetState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): NetState => this.state;

  async call(event: string, payload: unknown = {}): Promise<Ack> {
    try {
      return (await this.socket
        .timeout(10_000)
        .emitWithAck(event, payload)) as Ack;
    } catch {
      return {
        ok: false,
        code: "timeout",
        message: "サーバーにつながりません。通信を確かめてください。",
      };
    }
  }

  /**
   * この画面の人を決める。resume=true なら、保存したトークンで入り直す。
   * （作成・参加の直後は、サーバーがすでにこの接続をつないでいるので入り直さない）
   */
  start(session: Session, resume: boolean): void {
    this.session = session;
    this.set({ notice: null, resumeError: null });
    if (resume) void this.resume();
  }

  /** この画面がすでにその人として動いているか */
  isCurrent(kind: Session["kind"], code: string): boolean {
    return this.session?.kind === kind && this.session.code === code;
  }

  /** 別の画面に取られたあと、この画面で続ける */
  takeOver(): void {
    this.set({ notice: null });
    void this.resume();
  }

  private async resume(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const ack = await this.call(
      s.kind === "gm" ? "gm:resume" : "member:resume",
      s.kind === "gm"
        ? { code: s.code, gmToken: s.token }
        : { code: s.code, memberToken: s.token },
    );
    if (ack.ok || this.session !== s) return;
    if (ack.code === "timeout") return; // つながったら、また入り直す
    if (ack.code === "unauthorized" || ack.code === "room_not_found")
      storage.forget(s);
    this.session = null;
    this.set({
      resumeError: { code: ack.code, message: ack.message },
      view: null,
    });
  }
}

export const net = new Net();

export function useNet(): NetState {
  return useSyncExternalStore(net.subscribe, net.getState);
}
