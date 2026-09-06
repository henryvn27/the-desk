import { build } from "esbuild";
import { cp } from "node:fs/promises";
await cp("node_modules/@excalidraw/excalidraw/dist/prod/fonts","dist/fonts",{recursive:true});
await build({
  entryPoints: [
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.ts",
  ],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
  target: "node24",
});
await import("./build-extension.mjs");
