import { useEffect, useState } from "react";
import { fmtDateTime } from "../format";

// Topbar version chip: shows the git commit this build was made from, and
// quietly polls the deployed /version.json (on focus + every 5 minutes) to
// detect that a NEWER build has shipped — then turns into a "refresh" pill.
// Answers "which version am I looking at, and do I need to reload?" at a
// glance. Fail-open: no version.json (dev server) or a fetch error just means
// no update pill.
const POLL_MS = 5 * 60 * 1000;

async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" && body.version ? body.version : null;
  } catch {
    return null;
  }
}

export function VersionBadge() {
  const [deployed, setDeployed] = useState<string | null>(null);

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

  const updateAvailable = deployed != null && __APP_VERSION__ !== "dev" && deployed !== __APP_VERSION__;

  if (updateAvailable) {
    return (
      <button
        className="version-chip version-chip--update"
        onClick={() => window.location.reload()}
        title={`A newer version (${deployed}) is deployed — click to reload. You're on ${__APP_VERSION__}.`}
      >
        ↻ update to {deployed}
      </button>
    );
  }
  return (
    <span className="version-chip" title={`Build ${__APP_VERSION__} · built ${fmtDateTime(__BUILD_AT__)} · up to date`}>
      v{__APP_VERSION__}
    </span>
  );
}
