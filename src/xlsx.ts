// Multi-sheet Excel (.xlsx) export — used by the Raw data tab's "Export all"
// so every table lands on its own sheet in one workbook (a real .csv can't hold
// multiple sheets). Client-side via write-excel-file; no server round-trip.

import writeXlsxFile from "write-excel-file/browser";

export interface WorkbookSheet {
  name: string; // becomes the sheet/tab name (Excel caps at 31 chars)
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

// One workbook cell: write-excel-file wants a {value, type} object (type given
// as the String/Number/Boolean constructor) or null for blank. Header is bold.
type WCell =
  | { value: string | number | boolean; type: typeof String | typeof Number | typeof Boolean }
  | { value: string; fontWeight: "bold" }
  | null;

function dataCell(v: string | number | boolean | null): WCell {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return { type: Number, value: v };
  if (typeof v === "boolean") return { type: Boolean, value: v };
  return { type: String, value: String(v) };
}

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

// Sheet names must be unique and ≤31 chars; trim/dedupe defensively.
function sheetName(name: string, used: Set<string>): string {
  const base = name.slice(0, 31);
  let n = base;
  let i = 2;
  while (used.has(n)) n = `${base.slice(0, 28)}_${i++}`;
  used.add(n);
  return n;
}

export async function downloadWorkbook(fileName: string, sheets: WorkbookSheet[]): Promise<void> {
  const used = new Set<string>();
  const wb = sheets.map((s) => ({
    sheet: sheetName(s.name, used),
    data: s.columns.length
      ? [
          s.columns.map((c) => ({ value: c, fontWeight: "bold" as const })),
          ...s.rows.map((row) => row.map(dataCell)),
        ]
      : [[{ value: "(no rows)" }]],
  }));
  await writeXlsxFile(wb, {}).toFile(`${slugify(fileName)}-${stamp()}.xlsx`);
}
