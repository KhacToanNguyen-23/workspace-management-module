import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Local: the Worker runs on 8787 (`npm run dev:worker`).
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
