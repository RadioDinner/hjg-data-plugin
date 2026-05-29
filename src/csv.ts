// CSV export helpers. Client-side download via a Blob URL — no server round-trip.

type Cell = string | number | boolean | null | undefined;

// RFC4180 quoting: wrap in double quotes when the cell contains a comma, quote,
// CR, or LF; escape inner quotes by doubling.
function escape(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  const s = String(cell);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(columns: string[], rows: Cell[][]): string {
  const head = columns.map(escape).join(",");
  const body = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  return body.length ? `${head}\r\n${body}\r\n` : `${head}\r\n`;
}

// Build a filename-safe slug. Lowercases and replaces non-alphanumerics with
// hyphens; collapses runs; trims leading/trailing hyphens.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

// Trigger a CSV download in the browser. Filename ends with the current date so
// repeated exports stay distinct in the user's Downloads folder.
export function downloadCsv(name: string, columns: string[], rows: Cell[][]): void {
  const csv = toCsv(columns, rows);
  // Excel reads UTF-8 CSV correctly when a BOM is present.
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(name)}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before we release the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
