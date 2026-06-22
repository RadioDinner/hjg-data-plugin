// Data map as a first-class in-app tab (backlog #1). The interactive
// data-relationship graph lives as a self-contained static page at
// /data-map.html (a D3 snapshot). Rather than launch it in a separate browser
// tab — which breaks the app shell (no nav, no auth chrome) — we embed it in an
// iframe sized to the view, so it sits alongside the other tabs. The page is
// still served at /data-map.html, so the "open full screen" link works too.
// (Later: render the map natively in React to share auth/theme + read live
// Supabase — see the "Data map is a static snapshot" TODO in HANDOFF.)
export function DataMapView() {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="card__head">
        <div>
          <h2>Data map</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            How the mirrored CoachAccountable tables and HJG-owned tables relate. Drag to pan, scroll to zoom, click a
            table to focus its links.
          </div>
        </div>
        <a
          className="btn btn--sm"
          href="/data-map.html"
          target="_blank"
          rel="noopener"
          title="Open the data map full screen in a new tab"
        >
          Full screen ↗
        </a>
      </div>

      <iframe
        src="/data-map.html"
        title="HJG data map"
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
