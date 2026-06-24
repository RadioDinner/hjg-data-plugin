import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  createMenteeRecord,
  fetchAllMenteeRecords,
  updateMenteeRecordById,
  type MenteeRecord,
  type MenteeRecordEdit,
} from "../db";

// The Mentees tab: HJG's Notion-mirrored "Mentees Database" as an editable grid.
// Every column is editable inline (edit a cell, it saves on blur), like Notion.
// Edits persist to the `mentees` table (source of truth); a re-seed won't clobber.

type Kind = "text" | "date" | "num";
type Col = { key: keyof MenteeRecord; label: string; kind: Kind; w?: number };

// The retained mirrored Notion columns, in a sensible reading order. (9 columns —
// FF amount / FF paid? / Wants PP? / Date FF paid / Invoice amt / JS lesson /
// MN equiv / dd w a / Prayer partner — were removed 2026-06-24; migration 9979.)
const COLS: Col[] = [
  { key: "name", label: "Name", kind: "text", w: 160 },
  { key: "status", label: "Status", kind: "text", w: 150 },
  { key: "mentor", label: "Mentor", kind: "text", w: 110 },
  { key: "mentor_1", label: "Mentor (full)", kind: "text", w: 150 },
  { key: "dc_date", label: "DC date", kind: "date", w: 140 },
  { key: "projected_start", label: "Projected start", kind: "date", w: 140 },
  { key: "offering_signup", label: "Offering signup", kind: "date", w: 140 },
  { key: "email", label: "Email", kind: "text", w: 200 },
  { key: "phone", label: "Phone", kind: "text", w: 110 },
  { key: "associated_tasks", label: "Associated tasks", kind: "text", w: 240 },
];

// Cell value -> input string.
function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}
// Input string -> stored value for a column kind (null when blank).
function parse(kind: Kind, raw: string): string | number | null {
  const s = raw.trim();
  if (s === "") return null;
  if (kind === "num") {
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  }
  return s;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function MenteesView() {
  const { user } = useAuth();
  const [rows, setRows] = useState<MenteeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof MenteeRecord>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  // Per-row save state + a remount counter so a saved cell re-reads the stored value.
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [rev, setRev] = useState<Record<string, number>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAllMenteeRecords());
    } catch (e) {
      setError(
        String(e) +
          " — if the mentees table doesn't exist yet, apply migration 9986_mentees.sql in the Supabase SQL Editor."
      );
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows;
    if (q) {
      r = rows.filter((row) =>
        COLS.some((c) => toStr(row[c.key]).toLowerCase().includes(q))
      );
    }
    const dir = sortDir;
    return [...r].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, search, sortKey, sortDir]);

  function sortBy(key: keyof MenteeRecord) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  async function commit(row: MenteeRecord, col: Col, raw: string) {
    const next = parse(col.kind, raw);
    const cur = row[col.key] ?? null;
    if ((next ?? null) === (cur ?? null)) return; // unchanged
    setSavingId(row.id);
    setSavedId(null);
    try {
      const edit = { [col.key]: next } as MenteeRecordEdit;
      const saved = await updateMenteeRecordById(row.id, edit);
      setRows((rs) => rs.map((r) => (r.id === row.id ? saved : r)));
      setRev((m) => ({ ...m, [row.id]: (m[row.id] ?? 0) + 1 }));
      setSavedId(row.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function addMentee() {
    try {
      const rec = await createMenteeRecord(user?.id ?? "", "New mentee");
      setRows((rs) => [rec, ...rs]);
      setSearch("");
    } catch (e) {
      setError(String(e));
    }
  }

  function exportCsv() {
    const header = COLS.map((c) => csvCell(c.label)).join(",");
    const body = view.map((row) => COLS.map((c) => csvCell(row[c.key])).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mentees.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="card">
      <h2 style={{ marginBottom: 4 }}>Mentees — source of truth</h2>
      <p className="view__hint">
        HJG’s Notion “Mentees Database”, mirrored here and <strong>editable like Notion</strong> — edit any cell and it
        saves on blur to the <code>mentees</code> table. Prospects not yet in CoachAccountable are included (they have no
        linked client). Re-seeding from Notion never clobbers edits.
      </p>

      <div className="mentees__toolbar">
        <input
          type="search"
          className="journeys__search"
          style={{ maxWidth: 320 }}
          placeholder={`Search ${rows.length} mentees…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          {view.length} shown
          {savingId ? " · saving…" : savedId ? " · saved ✓" : ""}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn--sm" onClick={addMentee}>
          + Add mentee
        </button>
        <button className="btn btn--sm" onClick={exportCsv} disabled={!view.length}>
          Export CSV
        </button>
      </div>

      {error && <div className="notice notice--warn" style={{ marginTop: 10 }}>{error}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <div className="table-scroll mentees__scroll">
          <table className="table mentees__table">
            <thead>
              <tr>
                <th className="mentees__ca" title="Linked to a CoachAccountable client?">CA</th>
                {COLS.map((c) => (
                  <th
                    key={String(c.key)}
                    style={{ minWidth: c.w, cursor: "pointer" }}
                    onClick={() => sortBy(c.key)}
                    title="Sort"
                  >
                    {c.label}
                    {sortKey === c.key ? <span className="th__arrow"> {sortDir === 1 ? "▲" : "▼"}</span> : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((row) => (
                <tr key={row.id} className={savingId === row.id ? "mentees__row--saving" : ""}>
                  <td className="mentees__ca" title={row.client_id != null ? `CA client ${row.client_id}` : "Not in CoachAccountable"}>
                    {row.client_id != null ? "✓" : "—"}
                  </td>
                  {COLS.map((c) => (
                    <td key={String(c.key)}>
                      <input
                        key={`${row.id}:${String(c.key)}:${rev[row.id] ?? 0}`}
                        className="mentees__cell"
                        type={c.kind === "date" ? "date" : c.kind === "num" ? "number" : "text"}
                        step={c.kind === "num" ? "any" : undefined}
                        defaultValue={toStr(row[c.key])}
                        onBlur={(e) => commit(row, c, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {view.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 1} className="muted" style={{ padding: 14 }}>
                    No mentees match “{search}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
