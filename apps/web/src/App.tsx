/** 画面の切り替え：?r=部屋コード → 参加者、?gm=部屋コード → GM画面、なし → トップ */
import { useEffect, useState } from "react";
import { Gm } from "./Gm";
import { Member } from "./Member";
import { net, useNet } from "./net";
import { Top } from "./Top";

type Route =
  | { kind: "top" }
  | { kind: "gm"; code: string }
  | { kind: "member"; code: string };

const CODE = /^[A-Z0-9]{4,10}$/;

function readRoute(): Route {
  const q = new URLSearchParams(location.search);
  const r = q.get("r")?.trim().toUpperCase();
  if (r && CODE.test(r)) return { kind: "member", code: r };
  const gm = q.get("gm")?.trim().toUpperCase();
  if (gm && CODE.test(gm)) return { kind: "gm", code: gm };
  return { kind: "top" };
}

function go(route: Route): void {
  const q = new URLSearchParams(location.search);
  q.delete("r");
  q.delete("gm");
  if (route.kind === "gm") q.set("gm", route.code);
  if (route.kind === "member") q.set("r", route.code);
  const s = q.toString();
  history.pushState(null, "", `${location.pathname}${s ? `?${s}` : ""}`);
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const st = useNet();

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (r: Route) => {
    go(r);
    setRoute(r);
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <svg className="lupe" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="10"
              cy="10"
              r="6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            />
            <line
              x1="15"
              y1="15"
              x2="21.5"
              y2="21.5"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          </svg>
          <span className="name">modetective</span>
          <span className="beta">β</span>
        </div>
        <div className="sub">モデル探偵（仮称）</div>
      </header>

      <main>
        {st.notice === "replaced" ? (
          <div className="panel">
            <h1>別の画面で開かれました</h1>
            <p>
              同じ人の画面がほかのタブや端末で開かれたので、この画面は止まりました。
            </p>
            <button className="btn" onClick={() => net.takeOver()}>
              この画面で続ける
            </button>
          </div>
        ) : route.kind === "gm" ? (
          <Gm code={route.code} onLeave={() => navigate({ kind: "top" })} />
        ) : route.kind === "member" ? (
          <Member code={route.code} />
        ) : (
          <Top onEnterGm={(code) => navigate({ kind: "gm", code })} />
        )}
      </main>

      <footer className="foot">
        <span className="beta-note">
          β版：試作中です。内容や動きは変わることがあります。
        </span>
      </footer>
    </>
  );
}
