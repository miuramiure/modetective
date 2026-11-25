#!/usr/bin/env bash
# VM上で実行：サーバーの新しい版を展開して切り替える（deploy-server.mjs が送って呼ぶ）
#   sudo bash install-release.sh /tmp/modetective-release-<日時>.tgz
# 触るのは modetective のものだけ（/opt/modetective、/etc/modetective、/etc/caddy/games.d/modetective.caddy）
set -euo pipefail

TGZ=$1
NAME=$(basename "$TGZ" .tgz)
REL=/opt/modetective/releases/${NAME#modetective-release-}
ENV_FILE=/etc/modetective/env
CADDY_FILE=/etc/caddy/games.d/modetective.caddy
HEALTH=http://127.0.0.1:3102/modetective/api/health

echo "== 1. 展開：$REL =="
mkdir -p "$REL"
tar xzf "$TGZ" -C "$REL"
cd "$REL"

echo "== 2. 実行時の部品（socket.io）を入れる =="
npm install --omit=dev --no-audit --no-fund --no-package-lock
chown -R mdt:mdt "$REL"

echo "== 3. 設定ファイル（$ENV_FILE）=="
mkdir -p /etc/modetective /var/lib/modetective
chown mdt:mdt /var/lib/modetective
if [ ! -f "$ENV_FILE" ]; then
  install -m 640 -o root -g mdt infra/env.template "$ENV_FILE"
  echo "  $ENV_FILE を作りました（GM合言葉のハッシュはまだ空です。手元で pnpm gm-pass）"
fi

echo "== 4. systemd（起動するようにするのは、GM合言葉のハッシュがあるときだけ）=="
cp infra/modetective.service /etc/systemd/system/modetective.service
systemctl daemon-reload


echo "== 5. Caddy の振り分け（$CADDY_FILE）=="
if ! cmp -s infra/modetective.caddy "$CADDY_FILE"; then
  mkdir -p /etc/caddy/games.d
  [ -f "$CADDY_FILE" ] && cp "$CADDY_FILE" "$CADDY_FILE.bak"
  cp infra/modetective.caddy "$CADDY_FILE"
  if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo "  更新して reload しました"
  else
    echo "  Caddy の設定が通らないので、元に戻します"
    if [ -f "$CADDY_FILE.bak" ]; then mv "$CADDY_FILE.bak" "$CADDY_FILE"; else rm -f "$CADDY_FILE"; fi
    exit 1
  fi
else
  echo "  変更なし"
fi

echo "== 6. 切り替え =="
ln -sfn "$REL" /opt/modetective/current
if grep -Eq '^MDT_GM_PASS_HASH=.+' "$ENV_FILE"; then
  systemctl enable modetective >/dev/null 2>&1
  systemctl restart modetective
  echo "== 7. 動作確認 =="
  for _ in $(seq 1 15); do
    if curl -fsS "$HEALTH" 2>/dev/null; then echo; break; fi
    sleep 1
  done
  systemctl --no-pager --lines=5 status modetective | head -12 || true
else
  echo "GM合言葉のハッシュが未設定のため、まだ起動しません。手元で pnpm gm-pass を実行してください"
fi

echo "== 8. 古い版を片付ける（新しい5つを残す）=="
ls -1dt /opt/modetective/releases/*/ | tail -n +6 | xargs -r rm -rf
rm -f "$TGZ"
echo "完了：$REL"
