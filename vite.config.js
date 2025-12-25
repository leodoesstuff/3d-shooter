import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist"
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: [
      "threed-shooter.onrender.com"
    ]
  }
});
