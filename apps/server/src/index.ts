/** 起動。カード集がおかしい・設定が足りないときは起動しない */
import { createApp } from "./app.js";
import { loadCardsets } from "./cardsets.js";
import { loadConfig } from "./config.js";
import { FileStore, MemoryStore } from "./store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const cardsets = loadCardsets(config.cardsDir, config.defaultCardset);
  const store = config.roomsFile
    ? new FileStore(config.roomsFile)
    : new MemoryStore();
  const app = await createApp({ config, cardsets, store });
  const port = await app.listen();
  console.log(
    `[modetective] ${config.version} を http://${config.host}:${port} で起動しました（カード集 ${[...cardsets.keys()].join("・")}、部屋 ${app.manager.size}）`,
  );

  let closing = false;
  const stop = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[modetective] ${signal} を受けたので、部屋を保存して止めます`);
    app.close().then(
      () => process.exit(0),
      (e: unknown) => {
        console.error(e);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((e: unknown) => {
  console.error(
    `[modetective] 起動できませんでした：${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
});
