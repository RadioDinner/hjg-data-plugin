import { useEffect, useState } from "react";
import { fmtDateTime } from "../format";

// Topbar version chip: shows the human-readable app version (package.json,
// e.g. "v0.3.0"); the exact git commit + build time live in the tooltip. It
// quietly polls the deployed /version.json (on focus + every 5 minutes) and
// compares COMMITS — any newer deploy turns the chip into a "refresh" pill,
// even if a semver bump was forgotten. Fail-open: no version.json (dev server)
// or a fetch error just means no update pill.
const POLL_MS = 5 * 60 * 1000;

interface DeployedVersion {
  version: string | null; // semver, for the pill label
  commit: string | null; // short git hash, for update detection
}

async function fetchDeployedVersion(): Promise<DeployedVersion | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown; commit?: unknown };
    const version = typeof body.version === "string" && body.version ? body.version : null;
    const commit = typeof body.commit === "string" && body.commit ? body.commit : null;
    return version || commit ? { version, commit } : null;
  } catch {
    return null;
  }
}

export function VersionBadge() {
  const [deployed, setDeployed] = useState<DeployedVersion | null>(null);

  useEffect(() => {
    let live = true;
    const check = async () => {
      const v = await fetchDeployedVersion();
      if (live && v) setDeployed(v);
    };
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(check, POLL_MS);
    return () => {
      live = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, []);

  // Update detection by COMMIT (semver as a fallback for old-shape files).
  const updateAvailable =
    __APP_VERSION__ !== "dev" &&
    deployed != null &&
    (deployed.commit != null ? deployed.commit !== __APP_VERSION__ : deployed.version !== __APP_SEMVER__);

  if (updateAvailable) {
    const label = deployed?.version ? `v${deployed.version}` : deployed?.commit ?? "latest";
    return (
      <button
        className="version-chip version-chip--update"
        onClick={() => window.location.reload()}
        title={`A newer version (${label}${deployed?.commit ? ` · ${deployed.commit}` : ""}) is deployed — click to reload. You're on v${__APP_SEMVER__} (${__APP_VERSION__}).`}
      >
        ↻ update to {label}
      </button>
    );
  }
  return (
    <span
      className="version-chip"
      title={`v${__APP_SEMVER__} (build ${__APP_VERSION__}) · built ${fmtDateTime(__BUILD_AT__)} · up to date`}
    >
      v{__APP_SEMVER__}
    </span>
  );
}
