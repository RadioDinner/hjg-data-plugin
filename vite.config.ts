import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `vite dev`, proxy /api to a locally running `vercel dev` (default :3000)
// so the frontend can talk to the real serverless functions. When no backend is
// running, the frontend falls back to bundled mock data (see src/api.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
