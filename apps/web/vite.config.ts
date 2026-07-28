import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export const loopbackProxy = {
  "/api": {
    target: "http://127.0.0.1:3000",
    changeOrigin: false,
  },
  "/health": {
    target: "http://127.0.0.1:3000",
    changeOrigin: false,
  },
} as const;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 4173, strictPort: true, proxy: loopbackProxy },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy: loopbackProxy },
});
