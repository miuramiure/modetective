// 配置スクリプトの共通部分（Windows のコマンドプロンプトから pnpm で呼ぶ）
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
// VM（ITB と同居。GCP のリソースは ITB の Terraform 管理）
export const VM = "itb-play";
export const ZONE = "us-west1-b";
export const PROJECT = "itb-online";
export const HEALTH = "https://games-api.m-miura.jp/modetective/api/health";
export const SERVER_URL = "https://games-api.m-miura.jp";
export const WEB_URL = "https://modetective.m-miura.jp/";

// Windows では標準の tar.exe（bsdtar）を使う（Git Bash の GNU tar は「C:」を接続先と読み違える）
export const TAR =
  process.platform === "win32"
    ? join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe")
    : "tar";

/** コマンドを実行する。失敗したら止める */
export function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  // Windows では gcloud・pnpm は .cmd なので shell 経由で呼ぶ
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) throw new Error(`失敗しました：${cmd} ${args[0] ?? ""}`);
}

const where = ["--zone", ZONE, "--project", PROJECT, "--tunnel-through-iap"];

/** gcloud compute scp（IAP 経由）で VM の /tmp に送る（Windows では送り先に ~/ を使わない） */
export function scpToVm(files) {
  run("gcloud", ["compute", "scp", ...files, `${VM}:/tmp/`, ...where]);
}

/** VM でコマンドを実行する */
export function sshVm(command) {
  run("gcloud", ["compute", "ssh", VM, ...where, "--command", `"${command}"`]);
}

export async function health() {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { ok: false, status: r.status };
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
