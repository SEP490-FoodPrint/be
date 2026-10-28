export default {
  "*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}": [
    "eslint --max-warnings=0 --no-warn-ignored",
    "prettier --check",
  ],
  "*.{json,jsonc,md,yml,yaml}": "prettier --check",
};
