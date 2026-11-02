import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  preview: { port: 1421, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 700 },
  clearScreen: false,
});
