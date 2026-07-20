import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Build identity — lets the app show WHICH commit is running (topbar version
// chip) and detect when a newer build has been deployed. Prefer Vercel's env
// (present on production builds), fall back to git for local builds, then "dev".
function resolveVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}
const APP_VERSION = resolveVersion();
const BUILD_AT = new Date().toISOString();

// Emit /version.json alongside the bundle. The deployed file always describes
// the LATEST build; the running app compares it to its own baked-in version and
// offers a refresh when they differ (real static files win over the SPA rewrite,
// same as pay-map.html).
function versionJson(): Plugin {
  return {
    name: "hjg-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: APP_VERSION, builtAt: BUILD_AT }),
      });
    },
  };
}

// During `vite dev`, proxy /api to a locally running `vercel dev` (default :3000)
// so the frontend can talk to the real serverless functions. When no backend is
// running, the frontend falls back to bundled mock data (see src/api.ts).
export default defineConfig({
  plugins: [react(), versionJson()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_AT__: JSON.stringify(BUILD_AT),
  },
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
