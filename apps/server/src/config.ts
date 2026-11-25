/** 設定。VM では /etc/modetective/env（systemd の EnvironmentFile）から読む */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hashPasswordSync } from "./secrets.js";

export interface Config {
  host: string;
  port: number;
  /** GM合言葉のハッシュ（secrets.ts の形式） */
  gmPassHash: string;
  /** 受け付ける Origin */
  allowedOrigins: string[];
  /** 部屋の保存先（rooms.json）。null ならメモリだけ */
  roomsFile: string | null;
  /** カード集のフォルダ（data/cards） */
  cardsDir: string;
  /** 新しく作る部屋のカード集の版 */
  defaultCardset: string;
  /** health で返す版 */
  version: string;
  /** X-Forwarded-For の最後の値を相手のIPとみなす（Caddy の後ろで動かすとき） */
  trustProxy: boolean;
}

export const PROD_ORIGIN = "https://modetective.m-miura.jp";
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];
/** 開発用のGM合言葉（本番では使えない） */
export const DEV_GM_PASS = "dev";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(here("../package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const prod = env.NODE_ENV === "production";
  let gmPassHash = env.MDT_GM_PASS_HASH ?? "";
  if (!gmPassHash) {
    if (prod)
      throw new Error(
        "MDT_GM_PASS_HASH が設定されていません（/etc/modetective/env）",
      );
    console.warn(
      `[modetective] MDT_GM_PASS_HASH がないので、開発用のGM合言葉「${DEV_GM_PASS}」を使います`,
    );
    gmPassHash = hashPasswordSync(DEV_GM_PASS);
  }
  const origins = (env.MDT_ALLOWED_ORIGINS ?? PROD_ORIGIN)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const roomsFile =
    env.MDT_ROOMS_FILE ??
    (prod ? "/var/lib/modetective/rooms.json" : here("../.data/rooms.json"));
  return {
    host: env.MDT_HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 3102),
    gmPassHash,
    allowedOrigins: prod ? origins : [...new Set([...origins, ...DEV_ORIGINS])],
    roomsFile: roomsFile === "" ? null : roomsFile,
    cardsDir: env.MDT_CARDS_DIR ?? here("../../../data/cards"),
    defaultCardset: env.MDT_CARDSET ?? "v0.4",
    version: env.MDT_RELEASE ?? packageVersion(),
    trustProxy: env.MDT_TRUST_PROXY ? env.MDT_TRUST_PROXY === "1" : prod,
  };
}
