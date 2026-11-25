// 画面を WING（modetective.m-miura.jp）に配置する：pnpm deploy:web [--zip]
// 1. 本番用にビルド（接続先 games-api.m-miura.jp）
// 2. .htaccess を加える
// 3. SSH 鍵で WING に送る（infra/scripts/wing.env に接続先）。--zip ならファイルマネージャー用の zip を作るだけ
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ROOT, SERVER_URL, TAR, WEB_URL, run, stamp } from "./lib.mjs";

const DIST = join(ROOT, "apps/web/dist");
const zipOnly = process.argv.includes("--zip");

run("pnpm", ["--filter", "@mdt/web", "build"], {
  cwd: ROOT,
  env: { ...process.env, VITE_SERVER_URL: SERVER_URL },
});
writeFileSync(
  join(DIST, ".htaccess"),
  readFileSync(join(ROOT, "infra/web/.htaccess"), "utf8"),
);

if (zipOnly) {
  mkdirSync(join(ROOT, "build"), { recursive: true });
  const zip = join(ROOT, "build", `modetective-web-${stamp()}.zip`);
  run(TAR, ["-a", "-c", "-f", zip, "-C", DIST, "."]);
  console.log(`zip を作りました：${zip}`);
  console.log(
    "WING のファイルマネージャーで public_html/modetective.m-miura.jp/ に上げて展開してください（.htaccess を含みます）",
  );
  process.exit(0);
}

const envFile = join(ROOT, "infra/scripts/wing.env");
if (!existsSync(envFile)) {
  console.error(
    "infra/scripts/wing.env がありません（wing.env.example を見本に作成。SSH鍵での送り先）。zip にするなら --zip",
  );
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);
const { WING_HOST, WING_USER, WING_PORT = "8022", WING_PATH, WING_KEY } = env;
if (!WING_HOST || !WING_USER || !WING_PATH)
  throw new Error("wing.env に WING_HOST・WING_USER・WING_PATH が要ります");
const keyArgs = WING_KEY ? ["-i", WING_KEY] : [];
// dist の中身をまとめて送る（古いハッシュ付きファイルは残るが害はない）
const items = readdirSync(DIST).map((f) => join(DIST, f));
run("scp", [
  "-P",
  WING_PORT,
  ...keyArgs,
  "-r",
  ...items,
  `${WING_USER}@${WING_HOST}:${WING_PATH}/`,
]);
console.log(`配置しました：${WEB_URL}`);
