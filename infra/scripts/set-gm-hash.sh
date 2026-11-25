#!/usr/bin/env bash
# VM上で実行：GM合言葉のハッシュを /etc/modetective/env に書き、サーバーを再起動する（gm-pass.mjs が送って呼ぶ）
#   sudo bash set-gm-hash.sh <ハッシュを base64 にしたもの>
# ハッシュには $ が入るので、途中のシェルで崩れないよう base64 で受け取る
set -euo pipefail

ENV_FILE=/etc/modetective/env
HEALTH=http://127.0.0.1:3102/modetective/api/health
HASH=$(printf '%s' "$1" | base64 -d)

if ! [[ $HASH =~ ^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$ ]]; then
  echo "ハッシュの形が正しくありません"
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE がありません。先に pnpm deploy:server を実行してください"
  exit 1
fi

TMP=$(mktemp)
grep -v '^MDT_GM_PASS_HASH=' "$ENV_FILE" > "$TMP" || true
# 一重引用符で囲む（systemd が $ を変数として読まないように）
printf "MDT_GM_PASS_HASH='%s'\n" "$HASH" >> "$TMP"
install -m 640 -o root -g mdt "$TMP" "$ENV_FILE"
rm -f "$TMP"
echo "GM合言葉のハッシュを $ENV_FILE に書きました"

if [ ! -e /opt/modetective/current ]; then
  echo "サーバーがまだ配置されていません。pnpm deploy:server で配置すると起動します"
  exit 0
fi
systemctl enable modetective >/dev/null 2>&1
systemctl restart modetective
for _ in $(seq 1 15); do
  if curl -fsS "$HEALTH" >/dev/null 2>&1; then break; fi
  sleep 1
done
# 動いているサーバーが同じハッシュを読んだか確かめる
PID=$(systemctl show -p MainPID --value modetective)
if [ "$PID" != "0" ] && tr '\0' '\n' < "/proc/$PID/environ" | grep -qxF "MDT_GM_PASS_HASH=$HASH"; then
  echo "サーバーを再起動しました（新しい合言葉で動いています）"
  curl -fsS "$HEALTH" && echo
else
  echo "サーバーが新しい合言葉で動いていません。sudo journalctl -u modetective -n 30 で確かめてください"
  exit 1
fi
