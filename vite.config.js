import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist" },
  preview: { port: 4173, strictPort: true, host: true }
});
