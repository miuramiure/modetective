/**
 * 部屋の置き場（メモリ）。core の操作を当てはめ、変わったら知らせ、まとめて保存し、期限切れを消す。
 */
import {
  isExpired,
  makeRoomCode,
  setConnected,
  type Cardset,
  type Rand,
  type Result,
  type Room,
} from "@mdt/core";
import type { RoomStore } from "./store.js";

export const MAX_ROOMS = 50;
export const SAVE_DELAY_MS = 1000;

export interface RoomManagerDeps {
  store: RoomStore;
  cardsets: Map<string, Cardset>;
  now: () => number;
  rand: Rand;
  /** 部屋が変わった（view を送り直す） */
  onChange: (code: string) => void;
  /** 部屋が消えた（期限切れ） */
  onClosed: (code: string) => void;
  log?: (msg: string) => void;
  saveDelayMs?: number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RoomManagerDeps) {}

  /** 保存した部屋を読み戻す。期限切れ・カード集のない部屋は捨てる。全員を未接続にする */
  async init(): Promise<void> {
    const now = this.deps.now();
    for (const room of await this.deps.store.load()) {
      if (isExpired(room, now)) continue;
      if (!this.deps.cardsets.has(room.cardset)) {
        this.deps.log?.(
          `部屋 ${room.code} はカード集 ${room.cardset} がないので読み戻しません`,
        );
        continue;
      }
      for (const m of room.members) m.connected = false;
      this.rooms.set(room.code, room);
    }
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  cardsetOf(room: Room): Cardset {
    const cs = this.deps.cardsets.get(room.cardset);
    if (!cs) throw new Error(`カード集 ${room.cardset} がありません`);
    return cs;
  }

  get size(): number {
    return this.rooms.size;
  }

  get memberCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.members.length;
    return n;
  }

  isFull(): boolean {
    return this.rooms.size >= MAX_ROOMS;
  }

  newCode(): string {
    for (;;) {
      const code = makeRoomCode(this.deps.rand);
      if (!this.rooms.has(code)) return code;
    }
  }

  add(room: Room): void {
    this.rooms.set(room.code, room);
    this.changed(room.code);
  }

  /** core の操作を当てはめる。成功したら置き換えて知らせる */
  apply<T extends object>(
    code: string,
    op: (room: Room, cs: Cardset) => Result<T>,
  ): Result<T> | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    const r = op(room, this.cardsetOf(room));
    if (r.ok && r.room !== room) {
      this.rooms.set(code, r.room);
      this.changed(code);
    }
    return r;
  }

  setConnected(code: string, memberId: string, connected: boolean): void {
    this.apply(code, (room) => setConnected(room, memberId, connected));
  }

  private changed(code: string): void {
    this.scheduleSave();
    this.deps.onChange(code);
  }

  /** 期限切れの部屋を消す（定期的に呼ぶ） */
  sweep(): void {
    const now = this.deps.now();
    for (const [code, room] of [...this.rooms]) {
      if (!isExpired(room, now)) continue;
      this.rooms.delete(code);
      this.deps.onClosed(code);
      this.scheduleSave();
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, this.deps.saveDelayMs ?? SAVE_DELAY_MS);
  }

  private saveNow(): Promise<void> {
    const rooms = [...this.rooms.values()];
    this.saving = this.saving
      .then(() => this.deps.store.save(rooms))
      .catch((e: unknown) =>
        this.deps.log?.(`部屋の保存に失敗しました：${String(e)}`),
      );
    return this.saving;
  }

  /** 待っている保存をすぐに行う（終了時） */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.saveNow();
    }
    await this.saving;
  }
}
