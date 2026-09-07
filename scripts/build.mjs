import { build } from "esbuild";
import { chmod, cp, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await cp("node_modules/@excalidraw/excalidraw/dist/prod/fonts","dist/fonts",{recursive:true});
await mkdir("dist-electron", { recursive: true });
if (process.platform === "darwin") {
  execFileSync("clang", [
    "-O2",
    "-Wall",
    "-Wextra",
    "-framework",
    "CoreGraphics",
    "-framework",
    "CoreFoundation",
    "apps/desktop/electron/lens-hotkey.c",
    "-o",
    "dist-electron/lens-hotkey",
  ]);
  await chmod("dist-electron/lens-hotkey", 0o755);
}
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
