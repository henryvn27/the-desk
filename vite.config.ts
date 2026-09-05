import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/desktop",
  base: "./",
  build: { outDir: "../../dist", emptyOutDir: true },
});
