import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The portal is served by FastAPI at /portal (see app/main.py). In dev, Vite serves it on :3000
// and proxies the API so the browser only ever talks to one origin.
const API = process.env.VERITAX_API ?? "http://localhost:8000";
const proxied = ["/fta", "/supplier", "/maskan", "/meta", "/health"];

export default defineConfig({
  base: "/portal/",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: API, changeOrigin: true }])),
  },
});
