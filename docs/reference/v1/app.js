/* modetective β — モデル探偵（仮称）の進行アプリ
 * 静的ファイルだけで動く。データベースもサーバ側の処理も使わない。
 * お題データは CARD_FILE の md（共有用テーマカード集）をそのまま読む。
 */
'use strict';

// ===== 設定（必要に応じて変える） =====
const CARD_FILE = 'data/共有用_テーマカード集.md';
const MAX_REDRAW = 2;          // 引き直しの回数
const MAX_GROUPS = 10;
const PASSWORDS = ['ルーペ', 'ワトソン', 'パイプ', 'あしあと', 'アリバイ', 'てがかり', 'みっしつ', 'ベーカー街', 'あんごう', 'しょうこ', 'すいり', 'じょしゅ', 'めいたんてい', 'ききこみ'];
const CODE_CHARS = 'ACDEFGHJKLMNPQRTUVWXY34679'; // 読み間違えやすい文字を除く

// ===== 小道具 =====
const $app = () => document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const norm = s => String(s || '').normalize('NFKC').trim().toUpperCase();

function hash(str) { // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 覚えられなくても動く */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } }
};

// URL に入れる設定の変換（のぞき見防止程度）
const KEY = 'modetective';
function encodeGame(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b, i) => { bin += String.fromCharCode(b ^ KEY.charCodeAt(i % KEY.length)); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeGame(s) {
  try {
    let b = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const bytes = Uint8Array.from(bin, (c, i) => c.charCodeAt(0) ^ KEY.charCodeAt(i % KEY.length));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) { return null; }
}

// ===== md の読み込み =====
let DATA = null;

function splitCells(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()); }
function tableAfter(lines, startIdx) {
  const rows = [];
  let i = startIdx;
  while (i < lines.length && !lines[i].trim().startsWith('|')) { if (/^#{1,3} /.test(lines[i]) && i > startIdx) return rows; i++; }
  for (; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(splitCells(lines[i]));
  return rows;
}
function namesIn(cell) {
  return cell.replace(/（[^）]*）/g, '').split(/[、,]/).map(s => s.trim()).filter(s => s && s !== '―' && s !== '-');
}

function parseCards(text) {
  const lines = text.split(/\r?\n/);
  const cards = {};
  let cur = null;
  const scenes = { T: [], K: [] };
  const bounds = {}; // 正解の場面 → { near:Set, text:[] }

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const h = L.match(/^##\s+([TK]\d{2})\s+(★+)(?:\s+(\S+系))?/);
    if (h) {
      cur = { id: h[1], mode: h[1][0], stars: h[2], kind: h[3] || '', f: {} };
      cards[cur.id] = cur;
      continue;
    }
    if (/^#{1,2}\s/.test(L) && !h) cur = null;
    if (cur) {
      const b = L.match(/^- \*\*(.+?)\*\*(?:（[^）]*）)?：(.*)$/);
      if (b) cur.f[b[1]] = b[2].trim();
    }
    // 場面の選択肢リスト
    if (/^##\s+3-1/.test(L)) tableAfter(lines, i).slice(2).forEach(r => r.forEach(c => c && scenes.T.push(c)));
    if (/^##\s+3-2/.test(L)) tableAfter(lines, i).slice(2).forEach(r => r.forEach(c => c && scenes.K.push(c)));
    // 判定の境界
    if (/^##\s+4-[12]/.test(L)) {
      const mode = /4-1/.test(L) ? 'T' : 'K';
      tableAfter(lines, i).slice(2).forEach(r => {
        if (r.length < 4) return;
        const scene = r[0].replace(/（[^）]*）/g, '').trim();
        const key = mode + ':' + scene;
        const near = new Set([...namesIn(r[1]), ...namesIn(r[2])]);
        bounds[key] = { scene, near, near1: r[1], near2: r[2], text: r[3] };
      });
    }
  }
  // 整形
  Object.values(cards).forEach(c => {
    const f = c.f;
    c.scene = f['場面'] || '';
    c.purpose = f['目的'] || '';
    c.odai = f['お題'] || '';
    c.form = f['結論の形'] || '';
    c.memo = f['目的の判定メモ'] || '';
    c.options = (f['目的の選択肢'] || '').split('／').map(s => s.trim()).filter(Boolean);
    c.note = f['補足'] || '';
  });
  return { cards, scenes, bounds };
}

function boundOf(card) { return DATA.bounds[card.mode + ':' + card.scene] || null; }
function conflicts(a, b) {
  if (a.id === b.id || a.scene === b.scene) return true;
  for (const [x, y] of [[a, b], [b, a]]) {
    for (const k of ['T:', 'K:']) {
      const bd = DATA.bounds[k + x.scene];
      if (bd && bd.near.has(y.scene)) return true;
    }
    if (x.note && x.note.includes(y.id)) return true;
  }
  return false;
}

// ===== カードを配る =====
function deal(cfg) {
  const r = rng(cfg.s);
  const ids = Object.keys(DATA.cards).filter(id => id[0] === cfg.mode);
  const C = id => DATA.cards[id];
  const poolSize = cfg.dist === 'common' ? 1 : 1 + MAX_REDRAW;
  const groups = cfg.dist === 'common' ? 1 : cfg.n;
  const out = [];
  const used = {}; // 使った回数（グループ間でなるべくばらけさせる）
  for (let g = 0; g < groups; g++) {
    let best = null;
    for (let attempt = 0; attempt < 400 && !best; attempt++) {
      const order = shuffle(ids, r).sort((x, y) => (used[x] || 0) - (used[y] || 0));
      const A = [], B = [];
      for (const id of order) {
        if (A.length < poolSize && !B.includes(id) && B.every(b => !conflicts(C(id), C(b)))) { A.push(id); continue; }
        if (B.length < poolSize && !A.includes(id) && A.every(a => !conflicts(C(id), C(a)))) { B.push(id); }
        if (A.length === poolSize && B.length === poolSize) break;
      }
      if (A.length === poolSize && B.length === poolSize) best = { A, B };
    }
    if (!best) throw new Error('カードを配れませんでした（カードの枚数が足りない可能性があります）');
    [...best.A, ...best.B].forEach(id => { used[id] = (used[id] || 0) + 1; });
    out.push(best);
  }
  return out;
}
function poolFor(game, g, team) { const d = game.deck[game.dist === 'common' ? 0 : g]; return d[team]; }

// ===== 事件番号・合言葉 =====
function caseCode(game, cardId) {
  let h = hash(game.s + ':' + cardId);
  let s = '';
  for (let i = 0; i < 4; i++) { s += CODE_CHARS[h % CODE_CHARS.length]; h = Math.floor(h / CODE_CHARS.length); }
  return s;
}
function decodeCase(game, code) {
  const c = norm(code);
  return Object.keys(DATA.cards).find(id => id[0] === game.mode && caseCode(game, id) === c) || null;
}
function passwords(game) {
  const r = rng(game.s ^ 0x5bd1e995);
  const p = shuffle(PASSWORDS, r);
  return { deduce: p[0], reveal: p[1] };
}

// ===== 画面の部品 =====
const PHASES = [['select', 'チーム選択'], ['card', 'カード提示'], ['investigate', '調査フェーズ'], ['deduce', '推理フェーズ'], ['reveal', '解決編'], ['review', '振り返り']];
function setSteps(now) {
  const nav = document.getElementById('steps');
  if (!now) { nav.hidden = true; return; }
  nav.hidden = false;
  const idx = PHASES.findIndex(p => p[0] === now);
  nav.innerHTML = PHASES.map((p, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${i + 1}. ${p[1]}</span>`).join('');
}
function cardHTML(c, opts = {}) {
  if (!c) return '';
  const modeName = c.mode === 'T' ? 'シナリオモード' : '聞き込みモード';
  return `<div class="tcard">
    <div class="head"><span class="id">テーマカード ${esc(c.id)}　<span class="stars">${esc(c.stars)}</span></span><span>${modeName}${c.kind ? '・' + esc(c.kind) : ''}</span></div>
    <dl>
      <dt>場面</dt><dd>${esc(c.scene)}</dd>
      <dt>目的</dt><dd>${esc(c.purpose)}</dd>
      <dt>お題</dt><dd class="odai">${md(c.odai)}</dd>
      <dt>結論の形</dt><dd>${esc(c.form)}</dd>
      ${opts.memo && c.memo ? `<dt>目的の判定メモ</dt><dd>${esc(c.memo)}</dd>` : ''}
      ${opts.note && c.note ? `<dt>補足</dt><dd>${esc(c.note)}</dd>` : ''}
    </dl></div>`;
}
function balusBox(items, label = 'Balus での作業') {
  return `<div class="balus"><span class="label">${esc(label)}</span><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
}
const RULES_HTML = `<ol>
  <li>モデルに、<b>場面の一言</b>（選択肢リストにある言葉）や、<b>目的の文</b>を書かない。</li>
  <li>モデルに、<b>お題の問いの文</b>や<b>結論</b>を書かない。場面・目的・結論は、モデルから読み取れるようにする。</li>
  <li>お題に出てくる具体的な情報や、聞き込みで聞き出した事実は、要素として使ってよい。</li>
  <li>相手チームと相談しない。</li></ol>`;
const KIKIKOMI_HTML = `<table><tr><th>時間の目安</th><th>やること</th></tr>
  <tr><td>はじめの1分</td><td>チームの中から<b>聞き込み対象</b>を1人決める。カードの系統（日常系・仕事系）を見て、話しやすい人を選ぶ。チームが1人のときは自分自身。</td></tr>
  <tr><td>残り</td><td><b>聞き込みながらモデリングする</b>。ほかのメンバーがお題に沿って質問し、聞き出した流れや事実を、その場で Balus のモデルに描いていく。最後に結論を書く。</td></tr></table>
  <div class="note">話したくないことは、話さなくてかまいません。細部を変えたり、ぼかしたりしてもかまいません。人の実名、会社名、住所など、個人が特定できる情報はモデルに書かないでください（「上司」「取引先A」のように置き換えます）。</div>`;
const SCORE_HTML = `<table>
  <tr><th>項目</th><th>一致</th><th>部分一致</th><th>不一致</th></tr>
  <tr><td>場面</td><td>2点</td><td>―</td><td>0点</td></tr>
  <tr><td>目的</td><td>4点</td><td>1点（選択肢なしの場合のみ）</td><td>0点</td></tr>
  <tr><td>結論</td><td>4点</td><td>2点</td><td>0点</td></tr></table>
  <p class="muted">1方向の満点は10点、グループの満点は20点。結論を時間内に書けなかった方向は−3点、モデリングのルール1・2の違反は−2点。結論は、モデルを描いたチームが書いた結論と比べて判定します。</p>`;

function copyBtn(targetId, label = 'コピー') { return `<button class="btn small ghost" data-copy="${targetId}">${label}</button>`; }
function wireCopy(root) {
  root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const el = document.getElementById(b.dataset.copy);
    const text = el.value !== undefined ? el.value : el.textContent;
    try { await navigator.clipboard.writeText(text); } catch (e) { if (el.select) { el.select(); document.execCommand('copy'); } }
    const old = b.textContent; b.textContent = 'コピーしました'; setTimeout(() => (b.textContent = old), 1500);
  }));
}

// ===== ホーム（GM） =====
function viewHome() {
  setSteps(null);
  $app().innerHTML = `
  <h1>ゲームをはじめる（ゲームマスター用）</h1>
  <p class="lead">参加者の方は、ゲームマスターから配られたURLを開いてください。</p>
  <form id="f">
    <fieldset><legend>お題のモード</legend><div class="choices">
      <label class="choice"><input type="radio" name="mode" value="T" checked><span>シナリオモード<small>ゲーム側が用意した場面や設定でモデリング（T01〜）</small></span></label>
      <label class="choice"><input type="radio" name="mode" value="K"><span>聞き込みモード<small>チームの1人の実際の経験をもとにモデリング（K01〜）</small></span></label>
    </div></fieldset>
    <fieldset><legend>カードの提示のしかた</legend><div class="choices">
      <label class="choice"><input type="radio" name="dist" value="indiv" checked><span>個別カード方式<small>グループごとに違うカード。チームは2回まで引き直せる</small></span></label>
      <label class="choice"><input type="radio" name="dist" value="common"><span>共通カード方式<small>全グループのAに同じカード、Bに同じカード。引き直しなし</small></span></label>
    </div></fieldset>
    <fieldset><legend>目的の答え方</legend><div class="choices">
      <label class="choice"><input type="radio" name="purpose" value="choice" checked><span>選択肢あり<small>相手カードの5択から選ぶ</small></span></label>
      <label class="choice"><input type="radio" name="purpose" value="free"><span>選択肢なし<small>1文で自由に書く</small></span></label>
    </div></fieldset>
    <fieldset><legend>ゲームマスターの参加</legend><div class="choices">
      <label class="choice"><input type="radio" name="gmplay" value="0" checked><span>参加しない<small>GM画面に、配ったカードの場面と目的（答え）を表示する</small></span></label>
      <label class="choice"><input type="radio" name="gmplay" value="1"><span>GMも参加する<small>GM画面では答えを伏せ、事件番号だけを表示する</small></span></label>
    </div></fieldset>
    <fieldset><legend>グループ数</legend>
      <input type="number" name="n" min="1" max="${MAX_GROUPS}" value="1" style="width:6em"> グループ（1グループ＝Aチーム＋Bチーム）
    </fieldset>
    <div class="row"><button class="btn go" type="submit">ゲーム開始</button></div>
  </form>
  <details><summary>このアプリについて</summary>
    <p>モデル探偵（仮称）の進行を案内するアプリです。モデリングとタイマーは Balus で、回答の記入と採点は Balus や画面の外で行います。アプリは、カードの提示と、フェーズの案内・公開だけを行います。</p>
    <p>画面どうしは通信しません。ゲームの設定は URL に入っていて、フェーズは<b>合言葉</b>で進み、チームが確定したカードは<b>事件番号</b>で伝えます。</p>
  </details>`;
  document.getElementById('f').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let n = Math.max(1, Math.min(MAX_GROUPS, parseInt(fd.get('n'), 10) || 1));
    const game = { v: 1, s: (Math.random() * 2 ** 31) >>> 0, mode: fd.get('mode'), dist: fd.get('dist'), purpose: fd.get('purpose'), n, gp: fd.get('gmplay') === '1' ? 1 : 0 };
    try { game.deck = deal(game); } catch (err) { alertBox(err.message); return; }
    location.hash = 'gm=' + encodeGame(game);
  });
}
function alertBox(msg) { const p = document.createElement('p'); p.className = 'err'; p.textContent = msg; $app().prepend(p); }

// ===== GM画面 =====
const SCRIPT = (game) => {
  const pw = passwords(game);
  const kik = game.mode === 'K';
  return [
    ['ルール説明（初回のみ・10分）', 'ルールを説明する。チームごとのブレイクアウトルームと、Balus のモデルを描く場所を用意しておく。'],
    ['チーム選択・カード提示（3分）', `参加者URLをチャットで配り、「グループとチームを選んでください」と伝える。${game.dist === 'indiv' ? `各チームはカードを${MAX_REDRAW}回まで引き直せる。` : ''}「『これでいく』を押すと事件番号が出ます。事件番号をメインのチャットに書いてください」と伝える。ブレイクアウトルームを開く。`],
    ['調査フェーズ（15分）', `「Balus 上でモデリングしながら、お題について話し合ってください。時間は Balus のタイマーで確認してください」と伝える。${kik ? '聞き込みモードなので「聞き込み対象を1人決め、話を聞きながらモデリングしてください」と伝える。' : ''}結論は、モデルとは別の場所（Balus 上の決めた場所、またはGMへの個別メッセージ）に書いてもらう。巡回して進み具合を見る。`],
    ['推理フェーズ（10分）', `全体へのメッセージで「推理フェーズ開始。合言葉は <span class="pw">${esc(pw.deduce)}</span>」と伝える。ここで結論の締め切り。「Balus で相手チームのモデルを開いて読み取ってください。編集はしないでください。相手チームの事件番号を入れてください」と伝える。`],
    ['解決編・採点（5分）', `全員をメインルームに戻す。「解決編の合言葉は <span class="pw">${esc(pw.reveal)}</span>」と伝える。各チームに回答を発表してもらい、その回答にした理由（モデルのどこを見てそう読んだか）を口頭で説明してもらう。各チームの結論を公開し、下の配点で採点する。`],
    ['振り返り（セットの時間外）', '高得点・低得点のグループの Balus のモデルを画面共有し、振り返りの切り口に沿って話し合う。'],
  ];
};
function viewGM(game) {
  setSteps(null);
  const base = location.href.split('#')[0];
  const playURL = base + '#g=' + encodeGame(game);
  const pw = passwords(game);
  const C = id => DATA.cards[id];
  const groups = game.dist === 'common' ? Array.from({ length: game.n }, () => game.deck[0]) : game.deck;
  const gp = !!game.gp;
  const rows = groups.map((d, g) => ['A', 'B'].map(t => {
    const c = C(d[t][0]);
    return gp
      ? `<tr><td>G${g + 1}-${t}</td><td><b>${caseCode(game, c.id)}</b></td></tr>`
      : `<tr><td>G${g + 1}-${t}</td><td>${esc(c.id)} ${esc(c.stars)}</td><td>${esc(c.scene)}</td><td>${esc(c.purpose)}</td><td><b>${caseCode(game, c.id)}</b></td></tr>`;
  }).join('')).join('');
  const decoder = `<div class="panel">
    <div class="row"><input type="text" class="code" id="dc" maxlength="4" placeholder="XXXX"><button class="btn" id="dcb">調べる</button></div>
    <div id="dcout"></div></div>`;
  $app().innerHTML = `
  <h1>GM画面</h1>
  <p class="lead">${game.mode === 'T' ? 'シナリオモード' : '聞き込みモード'}／${game.dist === 'common' ? '共通カード方式' : '個別カード方式'}／目的は${game.purpose === 'choice' ? '選択肢あり' : '選択肢なし'}／${game.n}グループ／GMは${gp ? '参加する' : '参加しない'}</p>
  <div class="note">この画面のURLには答えが入っています。参加者に見せたり、配ったりしないでください。${gp ? '<br>GMも参加するので、この画面では答え（カード・場面・目的）を伏せています。GMは「参加者画面を開く」から自分のチームに参加してください。' : ''}</div>

  <h2>参加者に配るURL</h2>
  <div class="panel">
    <div class="url" id="playurl">${esc(playURL)}</div>
    <div class="row">${copyBtn('playurl', 'URLをコピー')}<a class="btn small ghost" href="${esc(playURL)}" target="_blank" rel="noopener">参加者画面を開く</a></div>
    <div id="qr" class="qr" hidden></div>
  </div>

  <h2>合言葉</h2>
  <div class="panel">
    <p>調査フェーズ → 推理フェーズ：<span class="pw">${esc(pw.deduce)}</span></p>
    <p>推理フェーズ → 解決編：<span class="pw">${esc(pw.reveal)}</span></p>
    <p class="muted">ひらがな・カタカナ・漢字は、ここに表示されているとおりに入力してもらいます。</p>
  </div>

  ${gp ? `<h2>最初に配ったカードの事件番号</h2>
  <div class="scroll"><table><tr><th>チーム</th><th>事件番号</th></tr>${rows}</table></div>
  <p class="muted">カード・場面・目的は伏せています。引き直したチームは、事件番号が変わります。</p>
  <details><summary>事件番号からカードを調べる（開くと答えが見えます）</summary>
    <p class="err">GMも参加しているので、ゲームが終わるまで使わないでください。</p>${decoder}</details>`
  : `<h2>最初に配ったカード（答え）</h2>
  <div class="scroll"><table><tr><th>チーム</th><th>カード</th><th>場面</th><th>目的</th><th>事件番号</th></tr>${rows}</table></div>
  ${game.dist === 'indiv' ? '<p class="muted">引き直したチームのカードは、下の「事件番号を調べる」で確かめてください。</p>' : ''}

  <h2>事件番号を調べる</h2>${decoder}`}

  <h2>進行の台本</h2>
  ${SCRIPT(game).map(([h, t]) => `<div class="panel"><h3 style="margin-top:0">${h}</h3><p style="margin:0">${t}</p></div>`).join('')}

  <h2>配点</h2>${SCORE_HTML}

  <div class="row" style="margin-top:24px">
    <button class="btn ghost" id="redeal">同じ設定でカードを配り直す</button>
    <a class="btn ghost" href="${esc(base)}#">ホームに戻る（次のセット）</a>
  </div>`;
  wireCopy($app());
  const show = () => {
    const id = decodeCase(game, document.getElementById('dc').value);
    document.getElementById('dcout').innerHTML = id ? cardHTML(C(id), { memo: true, note: true }) : '<p class="err">この事件番号は見つかりません。打ち間違いか、別のゲームの番号です。</p>';
  };
  document.getElementById('dcb').addEventListener('click', show);
  document.getElementById('dc').addEventListener('keydown', e => { if (e.key === 'Enter') show(); });
  document.getElementById('redeal').addEventListener('click', () => {
    const g2 = Object.assign({}, game, { s: (Math.random() * 2 ** 31) >>> 0 });
    g2.deck = deal(g2);
    location.hash = 'gm=' + encodeGame(g2);
  });
  const tryQR = (k = 0) => {
    if (window.QRCode) { const el = document.getElementById('qr'); el.hidden = false; new window.QRCode(el, { text: playURL, width: 180, height: 180, colorDark: '#00707C', colorLight: '#ffffff' }); }
    else if (k < 20) setTimeout(() => tryQR(k + 1), 150);
  };
  tryQR();
}

// ===== 参加者 =====
function stKey(game) { return 'modetective:' + game.s; }
function loadSt(game) { return store.get(stKey(game)) || { phase: 'select' }; }
function saveSt(game, st) { store.set(stKey(game), st); }

function viewPlayer(game, st) {
  const go = (patch) => { Object.assign(st, patch); saveSt(game, st); viewPlayer(game, st); window.scrollTo(0, 0); };
  setSteps(st.phase);
  const C = id => DATA.cards[id];
  const pool = st.team ? poolFor(game, st.group, st.team) : null;
  const my = pool ? C(pool[st.idx || 0]) : null;
  const myCode = my ? caseCode(game, my.id) : '';
  const tname = st.team ? `G${st.group + 1}・${st.team}チーム` : '';
  const opp = st.oppId ? C(st.oppId) : null;
  const pw = passwords(game);
  const kik = game.mode === 'K';
  const app = $app();

  const pwForm = (id, label) => `<div class="panel"><h3 style="margin-top:0">${label}</h3>
    <p class="muted">ゲームマスターが伝える合言葉を入れてください。</p>
    <div class="row"><input type="text" id="${id}" placeholder="合言葉"><button class="btn go" id="${id}-b">進む</button></div><div id="${id}-e"></div></div>`;
  const wirePw = (id, answer, next) => {
    const f = () => {
      if (norm(document.getElementById(id).value) === norm(answer)) next();
      else document.getElementById(id + '-e').innerHTML = '<p class="err">合言葉がちがいます。</p>';
    };
    document.getElementById(id + '-b').addEventListener('click', f);
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') f(); });
  };
  const oppForm = () => `<div class="panel"><h3 style="margin-top:0">相手チームの事件番号</h3>
    <p class="muted">相手チーム（${st.team === 'A' ? 'B' : 'A'}チーム）の事件番号を入れてください。メインのチャットなどで伝えられています。</p>
    <div class="row"><input type="text" class="code" id="oc" maxlength="4" placeholder="XXXX"><button class="btn" id="ocb">入れる</button></div><div id="oce"></div></div>`;
  const wireOpp = () => {
    const f = () => {
      const id = decodeCase(game, document.getElementById('oc').value);
      if (!id) { document.getElementById('oce').innerHTML = '<p class="err">この事件番号は見つかりません。打ち間違いがないか確かめてください。</p>'; return; }
      if (id === my.id) { document.getElementById('oce').innerHTML = '<p class="err">これは自分のチームの事件番号です。</p>'; return; }
      go({ oppId: id });
    };
    document.getElementById('ocb').addEventListener('click', f);
    document.getElementById('oc').addEventListener('keydown', e => { if (e.key === 'Enter') f(); });
  };

  if (st.phase === 'select') {
    const gopts = Array.from({ length: game.n }, (_, g) => `<label class="choice"><input type="radio" name="g" value="${g}" ${g === (st.group ?? 0) ? 'checked' : ''}><span>G${g + 1}</span></label>`).join('');
    app.innerHTML = `<h1>チームを選ぶ</h1>
      <p class="lead">${kik ? '聞き込みモード' : 'シナリオモード'}のゲームです。ゲームマスターの案内に従って、自分のグループとチームを選んでください。</p>
      <fieldset><legend>グループ</legend><div class="choices">${gopts}</div></fieldset>
      <fieldset><legend>チーム</legend><div class="choices">
        <label class="choice"><input type="radio" name="t" value="A" checked><span>Aチーム</span></label>
        <label class="choice"><input type="radio" name="t" value="B"><span>Bチーム</span></label></div></fieldset>
      <div class="note">同じチームの人どうしで、同じグループ・同じチームを選んでください。決めたあとは変えられません（変えるときはゲームマスターに相談してください）。</div>
      <div class="row"><button class="btn go" id="ok">このチームで参加する</button></div>`;
    document.getElementById('ok').addEventListener('click', () => {
      const g = parseInt(app.querySelector('input[name=g]:checked').value, 10);
      const t = app.querySelector('input[name=t]:checked').value;
      go({ phase: 'card', group: g, team: t, idx: 0 });
    });
    return;
  }

  if (st.phase === 'card') {
    const left = game.dist === 'common' ? 0 : (pool.length - 1 - (st.idx || 0));
    app.innerHTML = `<h1>テーマカード（${tname}）</h1>
      <p class="lead">チームで読んで、このカードでいくか決めてください。カードは相手チームに見せないでください。</p>
      ${cardHTML(my)}
      ${game.dist === 'common' ? '<p class="muted">共通カード方式なので、カードの引き直しはできません。</p>' : `<p class="muted">引き直しは、あと <b>${left}</b> 回できます。引き直すと、前のカードには戻れません。</p>`}
      <div class="row">
        ${game.dist === 'indiv' ? `<button class="btn ghost" id="redraw" ${left <= 0 ? 'disabled' : ''}>引き直す</button>` : ''}
        <button class="btn go" id="fix">これでいく</button></div>`;
    const rd = document.getElementById('redraw');
    if (rd) rd.addEventListener('click', () => { if (confirm('カードを引き直しますか？前のカードには戻れません。')) go({ idx: (st.idx || 0) + 1 }); });
    document.getElementById('fix').addEventListener('click', () => go({ phase: 'investigate', fixed: true }));
    return;
  }

  if (st.phase === 'investigate') {
    app.innerHTML = `<h1>調査フェーズ（${tname}）</h1>
      <div class="panel"><p style="margin:0">あなたのチームの<b>事件番号</b>：　<span class="badge-code" id="mycode">${myCode}</span> ${copyBtn('mycode')}</p>
      <p class="muted" style="margin:6px 0 0">この番号を、メインのチャットなどで相手チームとゲームマスターに伝えてください。番号から場面はわかりません。</p></div>
      ${balusBox([
        ...(kik ? ['<b>聞き込み対象の人に話を聞きながら</b>、同時に Balus でモデリングしてください（下の「聞き込みの進め方」）。'] : []),
        '<b>Balus 上でモデリングしながら、このお題について話し合ってください。</b>',
        '結論は、モデルとは別の場所に書いてください（場所はゲームマスターの案内に従ってください）。',
        'モデルには、場面の言葉、目的の文、お題の問い、結論を書かないでください。',
        '時間は Balus のタイマーで確認してください。'])}
      ${cardHTML(my)}
      ${kik ? `<h2>聞き込みの進め方</h2>${KIKIKOMI_HTML}` : ''}
      <h2>モデリングのルール</h2>${RULES_HTML}
      <h2>結論の書き方</h2><ul><li>お題の問いに、1〜3文で直接答えます。</li><li>締め切りは、ゲームマスターが「推理フェーズ開始」を知らせた時点です。</li></ul>
      ${pwForm('pw1', '推理フェーズへ進む')}`;
    wireCopy(app);
    wirePw('pw1', pw.deduce, () => go({ phase: 'deduce' }));
    return;
  }

  if (st.phase === 'deduce') {
    const sceneList = DATA.scenes[game.mode] || [];
    const tmpl = `モデル探偵 回答
グループ：G${st.group + 1}　チーム：${st.team}（読み取ったモデル：${st.team === 'A' ? 'B' : 'A'}チーム）

1. 場面（選択肢から1つ）：

2. 目的（${game.purpose === 'choice' ? '選択肢から1つ選ぶ' : '1文で書く'}）：

3. 結論（相手チームはこのモデルから何を結論したか）：
`;
    app.innerHTML = `<h1>推理フェーズ（${tname}）</h1>
      ${balusBox([
        '<b>Balus で相手チームのモデルを開いて、読み取ってください。</b>モデルは見るだけで、編集しないでください。',
        '回答（場面・目的・結論）は、下のひな形を使って、ゲームマスターが案内する場所に書いてください。その回答にした理由は書かず、解決編で発表するときに口頭で説明します。',
        '相手チームに質問してはいけません。モデルだけが手がかりです。',
        '時間は Balus のタイマーで確認してください。'])}
      ${opp ? `<div class="panel"><p style="margin:0">相手チームの事件番号：<b>${caseCode(game, opp.id)}</b>　<button class="btn small ghost" id="chg">入れ直す</button></p></div>` : oppForm()}
      ${game.purpose === 'choice' ? (opp ? `<h2>目的の選択肢（相手チームのカード）</h2><div class="panel"><ol class="opts">${opp.options.map(o => `<li>${esc(o)}</li>`).join('')}</ol></div>` : '<p class="muted">相手チームの事件番号を入れると、目的の選択肢が出ます。</p>') : '<h2>目的</h2><p>このモデルが何のために描かれたかを、1文で書いてください（選択肢はありません）。</p>'}
      <h2>場面の選択肢</h2><div class="scenes">${sceneList.map(s => `<div>${esc(s)}</div>`).join('')}</div>
      <h2>回答のひな形</h2><textarea id="tmpl">${esc(tmpl)}</textarea><div class="row">${copyBtn('tmpl', 'ひな形をコピー')}</div>
      <details><summary>自分のチームのカードを見る</summary>${cardHTML(my)}<p>事件番号：<b>${myCode}</b></p></details>
      ${pwForm('pw2', '解決編へ進む')}`;
    wireCopy(app);
    if (!opp) wireOpp(); else document.getElementById('chg').addEventListener('click', () => go({ oppId: null }));
    wirePw('pw2', pw.reveal, () => go({ phase: 'reveal' }));
    return;
  }

  if (st.phase === 'reveal') {
    if (!opp) {
      app.innerHTML = `<h1>解決編（${tname}）</h1>${oppForm()}`;
      wireOpp();
      return;
    }
    const bRow = c => { const b = boundOf(c); return b ? `<p class="muted"><b>まぎらわしい場面と判定の境界</b>：${esc(b.near1)}${b.near2 && b.near2 !== '―' ? '、' + esc(b.near2) : ''}<br>${esc(b.text)}</p>` : ''; };
    app.innerHTML = `<h1>解決編（${tname}）</h1>
      ${balusBox(['<b>Balus で両チームのモデルを開き、下の答えと見比べてください。</b>', '各チームの結論は、ゲームマスターが公開します。'])}
      <div class="reveal">
        <div class="side"><h3>相手チーム（${st.team === 'A' ? 'B' : 'A'}）のカード ＝ あなたが推理したモデル</h3>${cardHTML(opp, { memo: true, note: true })}${bRow(opp)}</div>
        <div class="side"><h3>自分のチーム（${st.team}）のカード</h3>${cardHTML(my, { memo: true, note: true })}${bRow(my)}</div>
      </div>
      <h2>配点</h2>${SCORE_HTML}
      <div class="row"><button class="btn go" id="next">振り返りへ</button></div>`;
    document.getElementById('next').addEventListener('click', () => go({ phase: 'review' }));
    return;
  }

  if (st.phase === 'review') {
    app.innerHTML = `<h1>振り返り</h1>
      ${balusBox(['<b>ゲームマスターが画面共有する Balus のモデルを見ながら</b>、話し合いましょう。'])}
      <h2>話し合いの切り口</h2><ul>
        <li>読み取ったチームは、モデルのどこを見て目的を読み取ったか。どこで読み違えたか</li>
        <li>モデルを描いたチームは、何を対象にし、どのビューで切ったか。ほかの切り方はあり得たか</li>
        <li>結論は、モデルの形そのものに現れていたか（例：「待ち」が描かれていたか）</li>
        ${game.dist === 'common' ? '<li>同じお題に対する各グループのモデルを並べ、対象やビューの選び方の違いと、それが得点にどう効いたかを見る</li>' : '<li>同じ場面で目的が違うカードが出ていれば、モデルを並べて違いを見る</li>'}
        ${kik ? '<li>聞き込み対象の人は、チームの結論に納得できるか</li><li>どんな質問が、モデルに効く事実を引き出したか</li>' : ''}
      </ul>
      <details><summary>自分と相手のカードをもう一度見る</summary>${cardHTML(my, { memo: true })}${cardHTML(opp, { memo: true })}</details>
      <p class="muted">次のセットは、ゲームマスターが新しいURLを配ります。</p>
      <div class="row"><button class="btn ghost" id="back">解決編に戻る</button></div>`;
    document.getElementById('back').addEventListener('click', () => go({ phase: 'reveal' }));
    return;
  }
}

// ===== 起動 =====
function route() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('gm=')) { const g = decodeGame(h.slice(3)); return g ? viewGM(g) : badLink(); }
  if (h.startsWith('g=')) {
    const g = decodeGame(h.slice(2));
    if (!g) return badLink();
    if (!g.deck || !g.deck.every(d => [...d.A, ...d.B].every(id => DATA.cards[id]))) return badLink('お題データが変わったため、このゲームは開けません。ゲームマスターに新しいURLをもらってください。');
    return viewPlayer(g, loadSt(g));
  }
  viewHome();
}
function badLink(msg) { setSteps(null); $app().innerHTML = `<p class="err">${esc(msg || 'URLが正しくありません。ゲームマスターから配られたURLを、そのまま開いてください。')}</p><p><a href="#">ホームへ</a></p>`; }

async function boot() {
  try {
    const res = await fetch(encodeURI(CARD_FILE), { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    DATA = parseCards(await res.text());
    if (!Object.keys(DATA.cards).length) throw new Error('カードが見つかりません');
  } catch (e) {
    $app().innerHTML = `<p class="err">お題データ（${esc(CARD_FILE)}）を読み込めませんでした。</p><p class="muted">Webサーバに置いて開いてください（パソコンのファイルを直接開くと読み込めません）。</p>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}
boot();
