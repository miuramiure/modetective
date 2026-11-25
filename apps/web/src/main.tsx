import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./style.css";

function App() {
  return (
    <main>
      <h1>モデル探偵</h1>
      <p>テーマの提示をサポートする進行アプリです。</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
