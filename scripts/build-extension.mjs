import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const output = "dist-extension";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [
    "apps/extension/src/background.ts",
    "apps/extension/src/popup.ts",
  ],
  outdir: output,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  entryNames: "[name]",
  logLevel: "warning",
});
await Promise.all([
  cp("apps/extension/manifest.json", `${output}/manifest.json`),
  cp("apps/extension/popup.html", `${output}/popup.html`),
  cp("apps/extension/popup.css", `${output}/popup.css`),
]);
console.log(`Built Chrome/Edge extension into ${output}/.`);
