import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 日本語の文言の全角スペースは許す（文字列・テンプレート・JSX の文字の中だけ）
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipTemplates: true, skipJSXText: true },
      ],
    },
  },
);
