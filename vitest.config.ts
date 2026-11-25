import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // テストでは @mdt/core をビルドせずにソースから読む
    alias: {
      "@mdt/core": fileURLToPath(
        new URL("packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
