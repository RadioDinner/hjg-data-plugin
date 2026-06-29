import { useMemo, useState } from "react";
import { parseNotionCsv, upsertMenteeNotion, DEFAULT_NOTION_MAP, type NotionImportResult } from "../db";

// The expected Notion headers (the carried columns), for the "found / missing" check.
const EXPECTED: { label: string; header: string }[] = [
  { label: "Name", header: DEFAULT_NOTION_MAP.name ?? "Mentees Paired" },
  { label: "Status", header: DEFAULT_NOTION_MAP.status ?? "Status" },
  { label: "Coach (Mentor 1)", header: DEFAULT_NOTION_MAP.coachPrimary ?? "Mentor 1" },
  { label: "Coach (Mentor)", header: DEFAULT_NOTION_MAP.coachSecondary ?? "Mentor" },
  { label: "Email", header: DEFAULT_NOTION_MAP.email ?? "Email Address" },
  { label: "Phone", header: DEFAULT_NOTION_MAP.phone ?? "Phone" },
  { label: "DC Date", header: DEFAULT_NOTION_MAP.dcDate ?? "DC Date" },
  { label: "Offering Signup", header: DEFAULT_NOTION_MAP.offeringSignup ?? "Offering Signup" },
];

// Import a Notion "Mentees Database" CSV export into the NOTION zone. Paste the
// CSV text or upload the file; it parses with the default HJG column mapping,
// previews what was found, then upserts ONLY the notion_* columns (matched by
// name) — never touching the CA zone or your hand edits. Re-importable.
export function NotionImportModal({ userId, onClose, onImported }: { userId?: string; onClose: () => void; onImported: (r: NotionImportResult) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return parseNotionCsv(text, DEFAULT_NOTION_MAP);
    } catch (e) {
      return { rows: [], header: [], skipped: 0, error: String(e) } as ReturnType<typeof parseNotionCsv> & { error: string };
    }
  }, [text]);

  const headerSet = useMemo(() => new Set((parsed?.header ?? []).map((h) => (h ?? "").replace(/^﻿/, "").trim())), [parsed]);
  const coachConflicts = useMemo(() => (parsed?.rows ?? []).filter((r) => r.notion_coach_conflict).length, [parsed]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setText(await f.text());
  }

  async function doImport() {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await upsertMenteeNotion(parsed.rows, userId);
      onImported(res);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "5vh 16px", overflow: "auto" }}
      onClick={onClose}
    >
      <div className="card" style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Import Notion CSV</h2>
          <button className="btn btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="view__hint">
          Paste your Notion <strong>Mentees Database</strong> export (or upload the file). It updates only the{" "}
          <strong>Notion zone</strong> — matched to existing mentees by name — and never touches the CA sync data or your hand edits.
          Re-import any time to refresh.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          <span className="muted" style={{ fontSize: 12 }}>or paste below</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Mentees Paired,Status,Mentor 1,…&#10;Daniel Strite,Done (Graduated),Arthur Nisly (https://…),…"
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
        />

        {parsed && (
          <div style={{ marginTop: 12 }}>
            <div className="stat-row">
              <div className="stat">
                <span className="stat__value">{parsed.rows.length}</span>
                <span className="stat__label">Rows to import</span>
              </div>
              <div className="stat">
                <span className="stat__value">{parsed.skipped}</span>
                <span className="stat__label">Blank / no-name skipped</span>
              </div>
              <div className="stat">
                <span className="stat__value">{coachConflicts}</span>
                <span className="stat__label">Mentor 1 ≠ Mentor</span>
              </div>
            </div>

            <h3 style={{ margin: "10px 0 6px", fontSize: 14 }}>Columns detected</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EXPECTED.map((c) => {
                const found = headerSet.has(c.header);
                return (
                  <span key={c.header} className={`pill ${found ? "pill--success" : ""}`} title={c.header}>
                    {found ? "✓" : "— missing"} {c.label}
                  </span>
                );
              })}
            </div>

            {parsed.rows.length > 0 && (
              <div className="table-scroll" style={{ marginTop: 10, maxHeight: 220 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Coach</th>
                      <th>Email</th>
                      <th>DC date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        <td>{r.name}</td>
                        <td>{r.notion_status ?? "—"}</td>
                        <td>
                          {r.notion_coach ?? "—"}
                          {r.notion_coach_conflict ? <span className="pill" style={{ marginLeft: 6 }} title="Mentor 1 ≠ Mentor">conflict</span> : null}
                        </td>
                        <td>{r.notion_email ?? "—"}</td>
                        <td>{r.notion_dc_date ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 8 ? <p className="muted" style={{ fontSize: 12 }}>…and {parsed.rows.length - 8} more.</p> : null}
              </div>
            )}
          </div>
        )}

        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button className="btn" onClick={doImport} disabled={busy || !parsed || parsed.rows.length === 0}>
            {busy ? "Importing…" : `Import ${parsed?.rows.length ?? 0} rows`}
          </button>
          <button className="btn btn--sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
