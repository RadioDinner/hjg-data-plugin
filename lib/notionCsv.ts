// Pure Notion-CSV ingestion for the Mentee management system (2026-06-27).
// Parses a Notion "Mentees Database" export and maps the CARRIED columns into the
// `notion_*` zone of a `mentees` row. The actual upsert (db.ts upsertMenteeNotion)
// writes ONLY notion_* columns, so a re-import refreshes the Notion zone without
// ever touching the CA zone or the hand layer.
//
// No I/O, no React — unit-tested in scripts/verify-metrics.ts §23.

// One parsed Notion row reduced to the notion_* zone (+ name for matching).
export interface NotionImportRow {
  name: string; // Notion "Mentees Paired" title; the match key + notion_name
  notion_status: string | null;
  notion_coach: string | null;
  notion_coach_conflict: boolean; // Mentor 1 ≠ Mentor
  notion_email: string | null;
  notion_phone: string | null;
  notion_dc_date: string | null; // ISO yyyy-mm-dd
  notion_offering_signup: string | null;
}

// Header → carried field. Mentor 1 (primary) + Mentor (secondary) reconcile into
// the single coach. Defaults match the current HJG Notion export headers; the UI
// lets staff remap and persists their choice.
export interface NotionColumnMap {
  name?: string;
  status?: string;
  coachPrimary?: string; // "Mentor 1"
  coachSecondary?: string; // "Mentor"
  email?: string;
  phone?: string;
  dcDate?: string;
  offeringSignup?: string;
}

export const DEFAULT_NOTION_MAP: NotionColumnMap = {
  name: "Mentees Paired",
  status: "Status",
  coachPrimary: "Mentor 1",
  coachSecondary: "Mentor",
  email: "Email Address",
  phone: "Phone",
  dcDate: "DC Date",
  offeringSignup: "Offering Signup",
};

// --- CSV parsing (RFC 4180) -------------------------------------------------
// Handles quoted fields, "" escaped quotes, embedded commas/newlines inside
// quotes, CRLF or LF line endings, and a leading UTF-8 BOM.
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the trailing field/row (no final newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- Cell helpers -----------------------------------------------------------
// Notion exports render relation/person cells as `Name (https://www.notion.so/…)`
// or `Name (https://app.notion.com/p/…)`. Strip the trailing parenthesized
// Notion URL (one or many), and any bare notion URL, then trim.
export function stripNotionLink(cell: string | null | undefined): string {
  let v = (cell ?? "").trim();
  if (!v) return "";
  // Drop ` (https://…notion…/…)` groups, repeatedly.
  v = v.replace(/\s*\((https?:\/\/[^)]*notion[^)]*)\)/gi, "");
  // Drop a bare leading/trailing notion URL with no parens.
  v = v.replace(/https?:\/\/[^\s,]*notion[^\s,]*/gi, "");
  return v.replace(/\s+/g, " ").trim();
}

export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Reconcile the two Notion mentor columns. If both are present and normalize
// equal → that value, no conflict. If one present → it. If both present and
// differ → prefer Mentor 1 and flag a conflict ("they should agree").
export function reconcileCoach(mentor1: string | null | undefined, mentor: string | null | undefined): { value: string | null; conflict: boolean } {
  const a = stripNotionLink(mentor1);
  const b = stripNotionLink(mentor);
  const aHas = a !== "" && !isNonePlaceholder(a);
  const bHas = b !== "" && !isNonePlaceholder(b);
  if (aHas && bHas) {
    const conflict = normalizeName(a) !== normalizeName(b);
    return { value: a, conflict };
  }
  if (aHas) return { value: a, conflict: false };
  if (bHas) return { value: b, conflict: false };
  return { value: null, conflict: false };
}

// Notion uses placeholder mentors like "~None Assigned" / "None Available".
function isNonePlaceholder(s: string): boolean {
  const n = normalizeName(s);
  return n === "none assigned" || n === "none available" || n === "none available placeholder" || n === "none";
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

// Parse a Notion date cell. Handles "Month DD, YYYY" (Notion's default), already-
// ISO yyyy-mm-dd, and M/D/YYYY. Returns ISO yyyy-mm-dd or null.
export function parseNotionDate(cell: string | null | undefined): string | null {
  const v = (cell ?? "").trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

// --- Row mapping ------------------------------------------------------------
export function buildHeaderIndex(header: string[]): Map<string, number> {
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const key = (h ?? "").replace(/^﻿/, "").trim();
    if (key && !idx.has(key)) idx.set(key, i);
  });
  return idx;
}

function cell(row: string[], idx: Map<string, number>, header: string | undefined): string | null {
  if (!header) return null;
  const i = idx.get(header.trim());
  if (i == null) return null;
  const raw = row[i];
  const v = stripNotionLink(raw);
  return v === "" ? null : v;
}

export function mapRowToNotion(row: string[], idx: Map<string, number>, map: NotionColumnMap): NotionImportRow {
  const name = cell(row, idx, map.name) ?? "";
  const coach = reconcileCoach(
    map.coachPrimary ? row[idx.get(map.coachPrimary.trim()) ?? -1] ?? null : null,
    map.coachSecondary ? row[idx.get(map.coachSecondary.trim()) ?? -1] ?? null : null
  );
  return {
    name,
    notion_status: cell(row, idx, map.status),
    notion_coach: coach.value,
    notion_coach_conflict: coach.conflict,
    notion_email: cell(row, idx, map.email),
    notion_phone: cell(row, idx, map.phone),
    notion_dc_date: parseNotionDate(cell(row, idx, map.dcDate)),
    notion_offering_signup: cell(row, idx, map.offeringSignup),
  };
}

// Parse a whole CSV into NotionImportRows (skipping blank rows + rows with no name).
export function parseNotionCsv(text: string, map: NotionColumnMap = DEFAULT_NOTION_MAP): { rows: NotionImportRow[]; header: string[]; skipped: number } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], header: [], skipped: 0 };
  const header = grid[0];
  const idx = buildHeaderIndex(header);
  const rows: NotionImportRow[] = [];
  let skipped = 0;
  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r];
    if (!raw || raw.every((c) => (c ?? "").trim() === "")) {
      skipped++;
      continue;
    }
    const mapped = mapRowToNotion(raw, idx, map);
    if (!mapped.name) {
      skipped++;
      continue;
    }
    rows.push(mapped);
  }
  return { rows, header, skipped };
}

// --- Match planning (pure) --------------------------------------------------
// Existing roster rows for matching (subset of MenteeRow).
export interface ExistingMentee {
  id: string;
  clientId: number | null;
  name: string | null; // name_override ?? notion_name ?? ca_name
}

export interface NotionUpsertPlan {
  updates: { id: string; row: NotionImportRow }[]; // matched 1:1 by name → refresh notion_*
  inserts: NotionImportRow[]; // no match → new Notion-only row (client_id null)
  ambiguous: { name: string; candidateIds: string[] }[]; // >1 match → skipped, surfaced in UI
}

// Match each import row to an existing mentee by normalized name. 0 → insert,
// 1 → update, >1 → ambiguous (skipped). Never matches on CA/hand fields beyond
// the resolved name; the upsert touches only notion_*.
export function planNotionUpsert(existing: ExistingMentee[], rows: NotionImportRow[]): NotionUpsertPlan {
  const byName = new Map<string, string[]>();
  for (const e of existing) {
    const key = normalizeName(e.name);
    if (!key) continue;
    const arr = byName.get(key) ?? [];
    arr.push(e.id);
    byName.set(key, arr);
  }
  const plan: NotionUpsertPlan = { updates: [], inserts: [], ambiguous: [] };
  for (const row of rows) {
    const key = normalizeName(row.name);
    const matches = key ? byName.get(key) ?? [] : [];
    if (matches.length === 1) plan.updates.push({ id: matches[0], row });
    else if (matches.length === 0) plan.inserts.push(row);
    else plan.ambiguous.push({ name: row.name, candidateIds: matches });
  }
  return plan;
}
