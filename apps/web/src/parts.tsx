/** 画面の部品と、v1 から引き継いだ文言（docs/reference/v1/app.js） */
import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  PHASES,
  PHASE_LABELS,
  type Bound,
  type Card,
  type Phase,
  type Settings,
} from "@mdt/core";

// ===== 小さな部品 =====
/** **太字** を <strong> にする */
export function Md({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</>;
}

export function Steps({ now }: { now: Phase }) {
  const idx = PHASES.indexOf(now);
  return (
    <nav className="steps" aria-label="フェーズ">
      {PHASES.map((p, i) => (
        <span key={p} className={i < idx ? "done" : i === idx ? "now" : ""}>
          {i + 1}. {PHASE_LABELS[p]}
        </span>
      ))}
    </nav>
  );
}

export function CardView({
  card,
  memo = false,
  note = false,
}: {
  card: Card;
  memo?: boolean;
  note?: boolean;
}) {
  return (
    <div className="tcard">
      <div className="head">
        <span className="id">
          テーマカード {card.id}　<span className="stars">{card.stars}</span>
        </span>
        <span>
          {card.mode === "T" ? "シナリオモード" : "聞き込みモード"}
          {card.kind ? `・${card.kind}` : ""}
        </span>
      </div>
      <dl>
        <dt>場面</dt>
        <dd>{card.scene}</dd>
        <dt>目的</dt>
        <dd>{card.purpose}</dd>
        <dt>お題</dt>
        <dd className="odai">
          <Md text={card.odai} />
        </dd>
        <dt>結論の形</dt>
        <dd>{card.form}</dd>
        {memo && card.memo && (
          <>
            <dt>目的の判定メモ</dt>
            <dd>{card.memo}</dd>
          </>
        )}
        {note && card.note && (
          <>
            <dt>補足</dt>
            <dd>{card.note}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function BoundView({ bound }: { bound: Bound | null | undefined }) {
  if (!bound) return null;
  return (
    <p className="muted">
      <b>まぎらわしい場面と判定の境界</b>：{bound.near1}
      {bound.near2 && bound.near2 !== "―" ? `、${bound.near2}` : ""}
      <br />
      <Md text={bound.text} />
    </p>
  );
}

export function BalusBox({
  items,
  label = "Balus での作業",
}: {
  items: ReactNode[];
  label?: string;
}) {
  return (
    <div className="balus">
      <span className="label">{label}</span>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function CopyButton({
  text,
  label = "コピー",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      window.prompt("コピーしてください", text);
    }
  };
  return (
    <button
      type="button"
      className="btn small ghost"
      onClick={() => void copy()}
    >
      {done ? "コピーしました" : label}
    </button>
  );
}

export function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(text, {
      type: "svg",
      margin: 1,
      color: { dark: "#00707C", light: "#ffffff" },
    }).then(setSvg, () => setSvg(""));
  }, [text]);
  if (!svg) return null;
  return (
    <div
      className="qr"
      role="img"
      aria-label="参加者URLのQRコード"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p className="err" role="alert">
      {message}
    </p>
  ) : null;
}

export const TIMER_NOTE = "時間は Balus のタイマーで確認してください。";

// ===== v1 から引き継いだ文言 =====
export function Rules() {
  return (
    <ol>
      <li>
        モデルに、<b>場面の一言</b>（選択肢リストにある言葉）や、<b>目的の文</b>
        を書かない。
      </li>
      <li>
        モデルに、<b>お題の問いの文</b>や<b>結論</b>
        を書かない。場面・目的・結論は、モデルから読み取れるようにする。
      </li>
      <li>
        お題に出てくる具体的な情報や、聞き込みで聞き出した事実は、要素として使ってよい。
      </li>
      <li>相手チームと相談しない。</li>
    </ol>
  );
}

export function Kikikomi() {
  return (
    <>
      <table>
        <tbody>
          <tr>
            <th>時間の目安</th>
            <th>やること</th>
          </tr>
          <tr>
            <td>はじめの1分</td>
            <td>
              チームの中から<b>聞き込み対象</b>
              を1人決める。カードの系統（日常系・仕事系）を見て、話しやすい人を選ぶ。チームが1人のときは自分自身。
            </td>
          </tr>
          <tr>
            <td>残り</td>
            <td>
              <b>聞き込みながらモデリングする</b>
              。ほかのメンバーがお題に沿って質問し、聞き出した流れや事実を、その場で
              Balus のモデルに描いていく。最後に結論を書く。
            </td>
          </tr>
        </tbody>
      </table>
      <div className="note">
        話したくないことは、話さなくてかまいません。細部を変えたり、ぼかしたりしてもかまいません。人の実名、会社名、住所など、個人が特定できる情報はモデルに書かないでください（「上司」「取引先A」のように置き換えます）。
      </div>
    </>
  );
}

export function Score() {
  return (
    <>
      <table>
        <tbody>
          <tr>
            <th>項目</th>
            <th>一致</th>
            <th>部分一致</th>
            <th>不一致</th>
          </tr>
          <tr>
            <td>場面</td>
            <td>2点</td>
            <td>―</td>
            <td>0点</td>
          </tr>
          <tr>
            <td>目的</td>
            <td>4点</td>
            <td>1点（選択肢なしの場合のみ）</td>
            <td>0点</td>
          </tr>
          <tr>
            <td>結論</td>
            <td>4点</td>
            <td>2点</td>
            <td>0点</td>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        1方向の満点は10点、グループの満点は20点。結論を時間内に書けなかった方向は−3点、モデリングのルール1・2の違反は−2点。結論は、モデルを描いたチームが書いた結論と比べて判定します。
      </p>
    </>
  );
}

export function ReviewPoints({ settings }: { settings: Settings }) {
  return (
    <ul>
      <li>
        読み取ったチームは、モデルのどこを見て目的を読み取ったか。どこで読み違えたか
      </li>
      <li>
        モデルを描いたチームは、何を対象にし、どのビューで切ったか。ほかの切り方はあり得たか
      </li>
      <li>
        結論は、モデルの形そのものに現れていたか（例：「待ち」が描かれていたか）
      </li>
      {settings.dist === "common" ? (
        <li>
          同じお題に対する各グループのモデルを並べ、対象やビューの選び方の違いと、それが得点にどう効いたかを見る
        </li>
      ) : (
        <li>
          同じ場面で目的が違うカードが出ていれば、モデルを並べて違いを見る
        </li>
      )}
      {settings.mode === "kikikomi" && (
        <>
          <li>聞き込み対象の人は、チームの結論に納得できるか</li>
          <li>どんな質問が、モデルに効く事実を引き出したか</li>
        </>
      )}
    </ul>
  );
}

/** GM の台本（v1 の SCRIPT を v2 の進め方に合わせたもの）。フェーズごと */
export function script(
  s: Settings,
  redrawLimit: number,
): Record<Phase, { title: string; text: string }[]> {
  const kik = s.mode === "kikikomi";
  return {
    lobby: [
      {
        title: "ルール説明（初回のみ・10分）",
        text: "ルールを説明する。チームごとのブレイクアウトルームと、Balus のモデルを描く場所を用意しておく。",
      },
      {
        title: "集合（3分）",
        text: "参加者URL（またはQRコード）をチャットで配り、「ニックネームを入れて、グループとチームを選んでください」と伝える。全員がチームを選んだら「カードを配る」を押す。",
      },
    ],
    card: [
      {
        title: "カード提示",
        text: `${s.dist === "individual" ? `各チームはカードを${redrawLimit}回まで引き直せる。` : "共通カード方式なので、引き直しはない。"}「チームの誰かが『これでいく』を押すと確定します。カードは相手チームに見せないでください」と伝える。ブレイクアウトルームを開く。`,
      },
    ],
    investigate: [
      {
        title: "調査フェーズ（15分）",
        text: `「調査フェーズへ」を押すと、まだ確定していないチームは表示中のカードで確定する。「Balus 上でモデリングしながら、お題について話し合ってください。時間は Balus のタイマーで確認してください」と伝える。${kik ? "聞き込みモードなので「聞き込み対象を1人決め、話を聞きながらモデリングしてください」と伝える。" : ""}結論は、モデルとは別の場所（Balus 上の決めた場所、またはGMへの個別メッセージ）に書いてもらう。巡回して進み具合を見る。`,
      },
    ],
    deduce: [
      {
        title: "推理フェーズ（10分）",
        text: "「推理フェーズへ」を押す。ここで結論の締め切り。「Balus で相手チームのモデルを開いて読み取ってください。編集はしないでください」と伝える。相手チームの目的の選択肢と場面の選択肢は、参加者の画面に自動で出る。",
      },
    ],
    reveal: [
      {
        title: "解決編・採点（5分）",
        text: "全員をメインルームに戻し、「解決編へ」を押す（両チームのカードが公開される）。各チームに回答を発表してもらい、その回答にした理由（モデルのどこを見てそう読んだか）を口頭で説明してもらう。各チームの結論を公開し、下の配点で採点する。",
      },
    ],
    review: [
      {
        title: "振り返り（セットの時間外）",
        text: "「振り返りへ」を押すと、全グループのカードが全員に公開される。高得点・低得点のグループの Balus のモデルを画面共有し、振り返りの切り口に沿って話し合う。続けるときは「次のセット」を押す（チーム分けはそのまま）。",
      },
    ],
  };
}

/** 推理フェーズの回答のひな形（場面・目的・結論の3項目） */
export function answerTemplate(team: string, purposeChoice: boolean): string {
  const [g = "", side = ""] = team.split("-");
  return `モデル探偵 回答
グループ：${g}　チーム：${side}（読み取ったモデル：${side === "A" ? "B" : "A"}チーム）

1. 場面（選択肢から1つ）：

2. 目的（${purposeChoice ? "選択肢から1つ選ぶ" : "1文で書く"}）：

3. 結論（相手チームはこのモデルから何を結論したか）：
`;
}

export function settingsSummary(s: Settings): string {
  return [
    s.mode === "scenario" ? "シナリオモード" : "聞き込みモード",
    s.dist === "common" ? "共通カード方式" : "個別カード方式",
    `目的は${s.purposeChoice ? "選択肢あり" : "選択肢なし"}`,
    `${s.groups}グループ`,
    `GMは${s.gmPlays ? "参加する" : "参加しない"}`,
  ].join("／");
}
