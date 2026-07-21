import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Build identity — the topbar chip shows the human-readable SEMVER from
// package.json (bumped on every shipped change); the git commit rides along in
// the tooltip and drives update detection (any new deploy = new commit, even if
// a bump was forgotten). Commit: prefer Vercel's env (production builds), fall
// back to git for local builds, then "dev".
const APP_SEMVER = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version || "0.0.0");
  } catch {
    return "0.0.0";
  }
})();
function resolveCommit(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}
const APP_VERSION = resolveCommit();
const BUILD_AT = new Date().toISOString();

// Emit /version.json alongside the bundle. The deployed file always describes
// the LATEST build; the running app compares its baked-in commit to it and
// offers a refresh when they differ (real static files win over the SPA rewrite,
// same as pay-map.html).
function versionJson(): Plugin {
  return {
    name: "hjg-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: APP_SEMVER, commit: APP_VERSION, builtAt: BUILD_AT }),
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
    __APP_SEMVER__: JSON.stringify(APP_SEMVER),
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
