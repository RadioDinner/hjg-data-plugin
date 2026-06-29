import { useState } from "react";
import { useTheme } from "../theme";

// The "Maps" tab — visual, in-app explainers, each a self-contained static page
// under public/ embedded in an iframe (kept as snapshots; no app data needed):
//  - Data map: how the mirrored CA tables + HJG tables relate (D3 graph).
//  - Payments: how mentor pay is calculated (the two-month split, interactive).
// A "Full screen ↗" link opens the selected page directly.
const MAPS = [
  {
    key: "data",
    label: "Data map",
    src: "/data-map.html",
    blurb: "How the mirrored CoachAccountable tables and HJG-owned tables relate. Drag to pan, scroll to zoom, click a table to focus its links.",
  },
  {
    key: "pay",
    label: "Payments",
    src: "/pay-map.html",
    blurb: "How mentor payments are calculated — the two-month split, with an interactive calculator and a worked example.",
  },
] as const;

type MapKey = (typeof MAPS)[number]["key"];

export function MapsView() {
  const { theme } = useTheme();
  const [active, setActive] = useState<MapKey>("data");
  const cur = MAPS.find((m) => m.key === active) ?? MAPS[0];
  const src = `${cur.src}?theme=${theme}`; // the static pages read ?theme to match light/dark

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="card__head">
        <div>
          <h2>Maps</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{cur.blurb}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="seg" role="tablist" aria-label="Map">
            {MAPS.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={active === m.key}
                className={`seg__btn ${active === m.key ? "seg__btn--active" : ""}`}
                onClick={() => setActive(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <a className="btn btn--sm" href={src} target="_blank" rel="noopener" title="Open this map full screen in a new tab">
            Full screen ↗
          </a>
        </div>
      </div>

      <iframe
        key={cur.key + theme}
        src={src}
        title={cur.label}
        style={{
          width: "100%",
          height: "calc(100vh - 230px)",
          minHeight: 480,
          border: "1px solid var(--line)",
          borderRadius: 10,
          background: "var(--panel-2)",
        }}
      />
    </section>
  );
}
