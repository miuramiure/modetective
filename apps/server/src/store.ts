/**
 * 部屋の保存の差し替え口。いまはファイル（rooms.json）。将来 Cloud Run などへ移すときはここを差し替える。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Room } from "@mdt/core";

export interface RoomStore {
  load(): Promise<Room[]>;
  save(rooms: Room[]): Promise<void>;
}

interface Snapshot {
  format: 1;
  savedAt: number;
  rooms: Room[];
}

export class FileStore implements RoomStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Room[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const snap = JSON.parse(text) as Snapshot;
    if (snap.format !== 1 || !Array.isArray(snap.rooms)) {
      throw new Error(`${this.file} の形式が正しくありません`);
    }
    return snap.rooms;
  }

  /** 一時ファイルに書いてから置き換える（書きかけのファイルを残さない） */
  async save(rooms: Room[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const snap: Snapshot = { format: 1, savedAt: Date.now(), rooms };
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(snap), "utf8");
    await rename(tmp, this.file);
  }
}

/** メモリだけ（テスト・保存しない設定用） */
export class MemoryStore implements RoomStore {
  data: string | null = null;
  saves = 0;

  async load(): Promise<Room[]> {
    return this.data ? (JSON.parse(this.data) as Room[]) : [];
  }

  async save(rooms: Room[]): Promise<void> {
    this.saves += 1;
    this.data = JSON.stringify(rooms);
  }
}
