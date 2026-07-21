// Build-time constants injected by vite.config.ts `define`:
//  __APP_SEMVER__  — the human-readable version from package.json (e.g. "0.3.0")
//  __APP_VERSION__ — the short git commit of the running build ("dev" under `vite dev`)
//  __BUILD_AT__    — ISO timestamp of when the build was made
declare const __APP_SEMVER__: string;
declare const __APP_VERSION__: string;
declare const __BUILD_AT__: string;
