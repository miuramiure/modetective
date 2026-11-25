// GM合言葉を設定・変更する：pnpm gm-pass [--print]
// 1. 合言葉を2回入れてもらう（画面には * だけ出す）
// 2. 手元でハッシュにする（サーバーと同じ apps/server/src/secrets.ts の形式）
// 3. ハッシュだけを VM に送り、/etc/modetective/env に書いて再起動する（set-gm-hash.sh）
// 合言葉そのものは、ファイルにもコマンドにも残さない。--print はハッシュを画面に出すだけ（VM に送らない）
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, health, run, scpToVm, sshVm } from "./lib.mjs";

const printOnly = process.argv.includes("--print");

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("コマンドプロンプトから直接実行してください"));
      return;
    }
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let s = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolve(s);
          return;
        }
        if (ch === "\u0003") {
          finish();
          reject(new Error("中止しました"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (s) {
            s = [...s].slice(0, -1).join("");
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue;
        s += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

// サーバーと同じハッシュの関数を使う（ビルド結果から読む）
run("pnpm", ["--filter", "@mdt/core", "--filter", "@mdt/server", "build"], {
  cwd: ROOT,
});
const { hashPasswordSync, normalizePass } = await import(
  pathToFileURL(join(ROOT, "apps/server/dist/secrets.js")).href
);

console.log("");
console.log("GM合言葉を決めます（研究会のGM役で共有するもの。日本語でも可）。");
console.log("全角・半角の違いと前後の空白は区別しません。");
const p1 = await readHidden("GM合言葉：");
const p2 = await readHidden("もう一度：");
const n = normalizePass(p1);
if (n !== normalizePass(p2)) {
  console.error("2回の入力が違います。もう一度やり直してください");
  process.exit(1);
}
if ([...n].length < 4 || n.length > 200) {
  console.error("合言葉は4文字以上にしてください");
  process.exit(1);
}
const hash = hashPasswordSync(n);

if (printOnly) {
  console.log("/etc/modetective/env に書く行：");
  console.log(`MDT_GM_PASS_HASH='${hash}'`);
  process.exit(0);
}

// ハッシュには $ が入るので、途中のシェルで崩れないよう base64 にして渡す
const b64 = Buffer.from(hash, "utf8").toString("base64");
scpToVm([join(ROOT, "infra/scripts/set-gm-hash.sh")]);
sshVm(`sudo bash /tmp/set-gm-hash.sh ${b64} && rm -f /tmp/set-gm-hash.sh`);
console.log("公開URLの health：", JSON.stringify(await health()));
console.log(
  "GM合言葉を設定しました。合言葉はGM役の人にだけ、口頭などで伝えてください",
);
