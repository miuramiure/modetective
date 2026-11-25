import { defineConfig, defaultClientConditions } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // @mdt/core はビルドせずにソース（package.json の "source"）から読む
  resolve: { conditions: ["source", ...defaultClientConditions] },
  build: { sourcemap: false },
  // サーバー（127.0.0.1:3102）とそろえる。localhost が IPv6 だけになるのを避ける
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
