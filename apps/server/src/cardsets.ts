/** data/cards/<版>.md をすべて読み、検証する。おかしければ投げる（起動しない） */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCardset, type Cardset } from "@mdt/core";

export function loadCardsets(
  dir: string,
  defaultVersion: string,
): Map<string, Cardset> {
  const sets = new Map<string, Cardset>();
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const version = name.slice(0, -3);
    sets.set(
      version,
      loadCardset(readFileSync(join(dir, name), "utf8"), version),
    );
  }
  if (!sets.has(defaultVersion)) {
    throw new Error(
      `既定のカード集 ${defaultVersion}.md が ${dir} にありません`,
    );
  }
  return sets;
}
