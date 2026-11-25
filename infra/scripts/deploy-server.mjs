// サーバーを VM（itb-play）に配置する：pnpm deploy:server
// 1. ビルド（@mdt/core と @mdt/server）
// 2. 実行に要るもの（サーバー、core、カード集、systemd・Caddy の設定）を tar にまとめる
// 3. gcloud compute scp（IAP経由）で VM へ送り、VM上で install-release.sh を実行（展開・部品の導入・切替・再起動）
// 4. 公開URLの health を確かめる
// 再起動しても部屋は rooms.json から戻る。開いている画面は自動でつなぎ直す
// --dry-run：tar を作るところまで（VM には送らない。中身の確認用）
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, TAR, health, run, scpToVm, sshVm, stamp } from "./lib.mjs";

const dryRun = process.argv.includes("--dry-run");

const before = dryRun ? {} : await health();
if (!dryRun) console.log("配置前の health：", JSON.stringify(before));
if ((before.rooms ?? 0) > 0)
  console.log(
    `部屋が ${before.rooms} つあります。再起動のあいだ（数秒）画面はつなぎ直しになりますが、部屋は戻ります`,
  );

run("pnpm", ["--filter", "@mdt/core", "--filter", "@mdt/server", "build"], {
  cwd: ROOT,
});

const ts = stamp();
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const serverPkg = readJson("apps/server/package.json");
const corePkg = readJson("packages/core/package.json");
const socketIo = readJson("apps/server/node_modules/socket.io/package.json");

const stage = mkdtempSync(join(tmpdir(), "modetective-release-"));
const put = (from, to) =>
  cpSync(join(ROOT, from), join(stage, to), { recursive: true });
put("apps/server/dist", "dist");
// core はビルド結果だけを持っていく（"source" の条件は外す）
put("packages/core/dist", "vendor/core/dist");
writeFileSync(
  join(stage, "vendor/core/package.json"),
  JSON.stringify(
    {
      name: "@mdt/core",
      version: corePkg.version,
      private: true,
      type: "module",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      },
    },
    null,
    2,
  ),
);
put("data/cards", "data/cards");
mkdirSync(join(stage, "infra"));
put("infra/systemd/modetective.service", "infra/modetective.service");
put("infra/systemd/env.template", "infra/env.template");
put("infra/caddy/modetective.caddy", "infra/modetective.caddy");
// health の version は「版+日時」（config.ts が ../package.json の version を読む）
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "modetective-server-release",
      version: `${serverPkg.version}+${ts}`,
      private: true,
      type: "module",
      dependencies: {
        "@mdt/core": "file:./vendor/core",
        "socket.io": socketIo.version,
      },
    },
    null,
    2,
  ),
);
const tgzName = `modetective-release-${ts}.tgz`;
const tgz = join(tmpdir(), tgzName);
run(TAR, ["-czf", tgz, "-C", stage, "."]);
rmSync(stage, { recursive: true, force: true });
if (dryRun) {
  console.log(`tar を作りました（送っていません）：${tgz}`);
  process.exit(0);
}

scpToVm([tgz, join(ROOT, "infra/scripts/install-release.sh")]);
sshVm(`sudo bash /tmp/install-release.sh /tmp/${tgzName}`);
rmSync(tgz, { force: true });

let after = await health();
for (let i = 0; i < 5 && !after.ok; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  after = await health();
}
console.log("配置後の health：", JSON.stringify(after));
if (!after.ok)
  console.log(
    "※GM合言葉がまだなら、サーバーは起動していません。pnpm gm-pass で設定してください",
  );
