// Pay stub PDFs (session 021) — the attachment on an emailed pay stub.
//
// Built from the SAME display models the printable stubs use
// (buildPayStubModel / buildHourlyStubModel), so the PDF and the print window
// can never disagree on a number: this file only lays the model out. Same visual
// language as the printed statement (olive + cream), redrawn in PDF primitives
// because the print stylesheet (CSS variables, flexbox) has no PDF equivalent.
//
// Pure — returns a pdfmake document definition, no I/O. The browser turns it into
// bytes (src/pdf.ts, lazy-loaded pdfmake); verify §30 renders it in Node.
// Roboto (the embedded font) has no "→" or "✓" glyphs, so the wording here
// avoids them where the HTML stub uses them.

import type { PayStubModel, StubInvoice, StubMenteeRow } from "./payStub";
import { DISPO_TEXT } from "./payStub";
import type { HourlyEntry, HourlyStubModel } from "./hourlyPay";
import { entryAmount, entryRate } from "./hourlyPay";
import { pieceAmount, type PieceEntry } from "./pieceWork";

// A pdfmake node — kept structural so this module needs no pdfmake types.
export type PdfNode = string | PdfNode[] | { [key: string]: unknown };

export interface PdfDocDefinition {
  pageSize: "LETTER";
  pageMargins: [number, number, number, number];
  info: { title: string; author: string; subject: string; creator: string };
  defaultStyle: Record<string, unknown>;
  content: PdfNode[];
  background: (page: number, size: { width: number; height: number }) => PdfNode;
  footer: (page: number, pageCount: number) => PdfNode;
  watermark?: Record<string, unknown>;
}

const OLIVE = "#77855c";
const OLIVE_DK = "#5c6a45";
const INK = "#2f3226";
const MUT = "#7a7d6f";
const LINE = "#dcd7c4";
const GOOD = "#3c7a44";
const WARN = "#a8722a";
const CARD = "#fbf9f1";
const ZEBRA = "#faf8ef";
const FOOT = "#eef0e3";
const HERO_SUB = "#e8ecdd";
const MARGIN_X = 40;
const CONTENT_W = 612 - MARGIN_X * 2; // LETTER is 612pt wide

const round2 = (n: number) => Math.round(n * 100) / 100;
// Same formatting as the printed stub (U+2212 minus is in Roboto).
export const pdfUsd = (n: number) =>
  (n < 0 ? "−$" : "$") +
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return m && d ? `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}-${y}` : ymd;
};
const fmtQty = (n: number) => round2(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtH = (n: number) => `${fmtQty(n)} h`;
// Symbols Roboto can't draw, in free text typed by staff (notes, labels).
const safe = (s: string) => (s ?? "").replace(/→/g, "->").replace(/[✓✔]/g, "");

type TagKind = "ok" | "good" | "warn" | "mut";
const TAG_COLORS: Record<TagKind, { color: string; background: string }> = {
  ok: { color: OLIVE_DK, background: FOOT },
  good: { color: GOOD, background: "#e5eede" },
  warn: { color: WARN, background: "#f5e8d2" },
  mut: { color: "#777777", background: "#ececec" },
};
function tag(text: string, kind: TagKind): PdfNode {
  return { text: ` ${text} `, fontSize: 6.5, bold: true, ...TAG_COLORS[kind] };
}

// --- shared building blocks -------------------------------------------------

function pageChrome(title: string): Pick<PdfDocDefinition, "background" | "footer"> {
  return {
    background: (_page, size) => ({
      canvas: [{ type: "rect", x: 0, y: 0, w: size.width, h: 8, color: OLIVE }],
    }),
    footer: (page, pageCount) => ({
      columns: [
        { text: title, alignment: "left" },
        { text: `Page ${page} of ${pageCount}`, alignment: "right", width: "auto" },
      ],
      margin: [MARGIN_X, 14, MARGIN_X, 0],
      fontSize: 7,
      color: MUT,
    }),
  };
}

function badge(approved: boolean, unsaved: boolean): PdfNode {
  const one = (text: string, ok: boolean): PdfNode => ({
    table: {
      body: [[{ text, bold: true, fontSize: 7.5, characterSpacing: 0.8, color: ok ? GOOD : WARN }]],
    },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => (ok ? "#b9cba8" : "#dcc294"),
      vLineColor: () => (ok ? "#b9cba8" : "#dcc294"),
      fillColor: () => (ok ? "#e5eede" : "#f5e8d2"),
      paddingLeft: () => 7,
      paddingRight: () => 7,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
  });
  const badges: PdfNode[] = [
    { width: "*", text: "" },
    {
      width: "auto",
      stack: [one(approved ? "APPROVED PAY STUB" : "REVIEW COPY — DRAFT", approved)],
    },
  ];
  if (unsaved)
    badges.push({ width: "auto", stack: [one("UNSAVED CHANGES", false)], margin: [6, 0, 0, 0] });
  return { columns: badges };
}

function header(input: {
  kicker: string;
  monthLabel: string;
  sub: string;
  approved: boolean;
  unsaved: boolean;
  paidTo: string;
  rateLine: PdfNode;
}): PdfNode {
  return {
    columns: [
      {
        width: "*",
        stack: [
          {
            text: input.kicker.toUpperCase(),
            fontSize: 7.5,
            bold: true,
            characterSpacing: 1.8,
            color: OLIVE_DK,
          },
          { text: input.monthLabel, fontSize: 24, margin: [0, 2, 0, 0] },
          { text: input.sub, fontSize: 8.5, color: MUT, margin: [0, 2, 0, 0] },
        ],
      },
      {
        width: 220,
        stack: [
          badge(input.approved, input.unsaved),
          {
            text: "PAID TO",
            fontSize: 7.5,
            bold: true,
            characterSpacing: 1.8,
            color: OLIVE_DK,
            alignment: "right",
            margin: [0, 10, 0, 0],
          },
          { text: input.paidTo, fontSize: 15, alignment: "right", margin: [0, 1, 0, 0] },
          { stack: [input.rateLine], alignment: "right", fontSize: 8.5, color: MUT },
        ],
      },
    ],
    margin: [0, 6, 0, 16],
  };
}

function card(label: string, value: string, rows: [string, string][], hero = false): PdfNode {
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              {
                text: label.toUpperCase(),
                fontSize: 7,
                bold: true,
                characterSpacing: 1,
                color: hero ? HERO_SUB : MUT,
              },
              {
                text: value,
                fontSize: hero ? 17 : 15,
                bold: hero,
                color: hero ? "#ffffff" : INK,
                margin: [0, 3, 0, 2],
              },
              ...rows.map(([l, r]) => ({
                columns: [
                  { text: l, width: "*" },
                  { text: r, width: "auto", alignment: "right", noWrap: true },
                ],
                fontSize: 7.5,
                color: hero ? HERO_SUB : MUT,
                margin: [0, 1, 0, 0],
              })),
            ],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => (hero ? OLIVE_DK : LINE),
      vLineColor: () => (hero ? OLIVE_DK : LINE),
      fillColor: () => (hero ? OLIVE : CARD),
      paddingLeft: () => 10,
      paddingRight: () => 10,
      paddingTop: () => 8,
      paddingBottom: () => 8,
    },
  };
}

function cardsRow(cards: PdfNode[]): PdfNode {
  return {
    columns: cards.map((c) => ({ width: "*", stack: [c] })),
    columnGap: 10,
    margin: [0, 0, 0, 16],
  };
}

const th = (text: string, align: "left" | "right" = "right"): PdfNode => ({
  text: text.toUpperCase(),
  color: "#ffffff",
  bold: true,
  fontSize: 7,
  characterSpacing: 0.6,
  alignment: align,
});
const num = (text: string, bold = false): PdfNode =>
  bold ? { text, alignment: "right", bold: true } : { text, alignment: "right" };

// Olive header row, zebra body, a heavier olive rule above the TOTAL row.
function statementTableLayout(totalRow: number) {
  return {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? 0 : i === totalRow ? 1.5 : 0.5,
    vLineWidth: () => 0,
    hLineColor: (i: number) => (i === totalRow ? OLIVE : LINE),
    fillColor: (row: number) =>
      row === 0 ? OLIVE : row === totalRow ? FOOT : row % 2 === 0 ? ZEBRA : null,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 4,
    paddingBottom: () => 4,
  };
}

function noteBlock(label: string, text: string): PdfNode {
  return {
    table: {
      widths: ["*"],
      body: [[{ text: [{ text: `${label} `, bold: true }, safe(text)], fontSize: 9 }]],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 2.5 : 0),
      vLineColor: () => OLIVE,
      fillColor: () => CARD,
      paddingLeft: () => 10,
      paddingRight: () => 10,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 12, 0, 0],
  };
}

function finePrint(parts: PdfNode[]): PdfNode {
  return {
    stack: [
      {
        canvas: [
          { type: "line", x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.5, lineColor: LINE },
        ],
        margin: [0, 0, 0, 6],
      },
      { text: parts, fontSize: 7.5, color: MUT, lineHeight: 1.3 },
    ],
    margin: [0, 16, 0, 0],
  };
}

function baseDoc(title: string, approved: boolean): Omit<PdfDocDefinition, "content"> {
  return {
    pageSize: "LETTER",
    pageMargins: [MARGIN_X, 30, MARGIN_X, 40],
    info: { title, author: "HJG", subject: "Pay stub", creator: "HJG Data Hub" },
    // Ligatures off: Roboto's "fl"/"fi" glyphs copy and search as "f" alone
    // ("flat" would paste as "fat"), and a pay stub gets copied into emails.
    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
      color: INK,
      lineHeight: 1.15,
      fontFeatures: { liga: false, clig: false },
    },
    ...pageChrome(title),
    ...(approved
      ? {}
      : {
          watermark: { text: "REVIEW COPY", color: WARN, opacity: 0.12, bold: true, angle: -28 },
        }),
  };
}

// --- mentor (engine) stub ---------------------------------------------------

function menteeNameCell(r: StubMenteeRow): PdfNode {
  const parts: PdfNode[] = [
    r.excluded ? { text: safe(r.name), decoration: "lineThrough" } : safe(r.name),
  ];
  if (r.excluded) parts.push("  ", tag("excluded", "warn"));
  else {
    if (r.overridden) parts.push("  ", tag("adjusted by HJG", "warn"));
    if (!r.overridden && r.adjusted) parts.push("  ", tag("reviewed", "good"));
  }
  return r.excluded ? { text: parts, color: MUT } : { text: parts };
}

function pieceSummaryRow(p: PieceEntry): PdfNode[] {
  const label: PdfNode[] = [safe(p.label || "—"), "  ", tag("piece work", "good")];
  if (p.date) label.push({ text: `  ${fmtD(p.date)}`, color: MUT });
  return [
    { text: label },
    { text: `${fmtQty(p.qty)} × ${pdfUsd(p.unitRate)}`, alignment: "right" },
    "",
    "",
    "",
    num(pdfUsd(pieceAmount(p)), true),
  ];
}

// Hourly work on a MENTOR stub: hours × rate, paid in full (no revenue split).
function hourSummaryRow(e: HourlyEntry, defaultRate: number): PdfNode[] {
  const label: PdfNode[] = [safe(e.label || "—"), "  ", tag("hourly", "good")];
  if (e.date) label.push({ text: `  ${fmtD(e.date)}`, color: MUT });
  return [
    { text: label },
    { text: `${fmtH(e.hours)} × ${pdfUsd(entryRate(e, defaultRate))}/h`, alignment: "right" },
    "",
    "",
    "",
    num(pdfUsd(entryAmount(e, defaultRate)), true),
  ];
}

function invoiceBlock(inv: StubInvoice, m: PayStubModel): PdfNode {
  const slice =
    inv.slice === "this-month"
      ? `${m.monthLabel} invoice · ${inv.fractionLabel}`
      : `${m.prevMonthLabel} invoice · ${inv.fractionLabel}`;
  const head: PdfNode[] = [
    { text: `Invoice #${safe(inv.invoiceNumber)}`, bold: true },
    ` · ${fmtD(inv.serviceDate)} · `,
    { text: slice, color: MUT },
  ];
  if (inv.wholeExcluded) head.push("  ", tag("invoice excluded by HJG review", "warn"));
  const counts: PdfNode[] =
    inv.counts !== inv.billed
      ? [{ text: pdfUsd(inv.counts), bold: true }, { text: ` (billed ${pdfUsd(inv.billed)})` }]
      : [{ text: pdfUsd(inv.billed), bold: true }];
  const items: PdfNode[] = inv.items.map((it) => {
    const d = DISPO_TEXT[it.disposition];
    const kind = (d.cls as TagKind) in TAG_COLORS ? (d.cls as TagKind) : "ok";
    return {
      columns: [
        { width: 62, text: pdfUsd(it.amount), alignment: "right" },
        { width: "*", text: [safe(it.label), "  ", tag(d.label, kind)] },
      ],
      columnGap: 8,
      fontSize: 8,
      color: kind === "mut" ? MUT : INK,
      margin: [0, 1.5, 0, 0],
    };
  });
  return {
    stack: [
      { text: head, fontSize: 8.5 },
      {
        text: [
          "counts ",
          ...counts,
          " · ",
          { text: pdfUsd(inv.recognized), bold: true },
          ` into ${m.monthLabel}`,
        ],
        fontSize: 8,
        color: MUT,
        margin: [0, 1, 0, 1],
      },
      ...items,
    ],
    ...(inv.wholeExcluded ? { color: MUT } : {}),
  };
}

function menteeBreakdown(r: StubMenteeRow, m: PayStubModel, pct: string): PdfNode {
  const body: PdfNode[][] = [
    [
      {
        stack: [
          {
            text: [
              { text: safe(r.name), bold: true, fontSize: 10.5 },
              { text: `  ·  ${safe(r.tier)}`, color: MUT },
            ],
          },
          {
            text: [
              `${pdfUsd(r.thisMonth)} this month + ${pdfUsd(r.rolledIn)} rolled in = `,
              { text: pdfUsd(r.earned), bold: true },
              ` × ${pct} = `,
              { text: pdfUsd(r.payout), bold: true },
            ],
            fontSize: 8,
            color: MUT,
            margin: [0, 2, 0, 0],
          },
        ],
        fillColor: CARD,
      },
    ],
  ];
  const callout = (text: PdfNode[]): PdfNode[] => [
    { text, fontSize: 8.5, fillColor: "#fdf7ec", color: INK },
  ];
  if (r.excluded)
    body.push(
      callout([
        "This mentee was excluded from this payout by HJG review.",
        ...(r.note ? [` Reason: ${safe(r.note)}`] : []),
      ]),
    );
  if (r.overridden)
    body.push(
      callout([
        "HJG set this payout to ",
        { text: pdfUsd(r.payout), bold: true },
        ` (calculated ${pdfUsd(r.enginePayout)}).`,
        ...(r.note ? [` Reason: ${safe(r.note)}`] : []),
      ]),
    );
  else if (!r.excluded && r.note) body.push(callout([`Review note: ${safe(r.note)}`]));
  for (const inv of r.invoices) body.push([invoiceBlock(inv, m)]);
  return {
    table: { widths: ["*"], headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1, body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      hLineStyle: (i: number, node: { table: { body: unknown[] } }) =>
        i <= 1 || i === node.table.body.length ? null : { dash: { length: 2, space: 2 } },
      paddingLeft: () => 9,
      paddingRight: () => 9,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
    margin: [0, 0, 0, 10],
  };
}

export function mentorStubPdfDoc(m: PayStubModel): PdfDocDefinition {
  const pct = `${Math.round(m.splitPct * 100)}%`;
  const title = `${m.coachName} — ${m.monthLabel} pay stub`;
  const included = m.rows.filter((r) => !r.excluded);

  const rateLine: PdfNode = {
    text: [
      `Payout rate ${pct}`,
      ...(m.splitAdjusted
        ? [
            "  ",
            tag(
              `set by HJG for this month (standard ${Math.round(m.engineSplitPct * 100)}%)`,
              "warn",
            ),
          ]
        : []),
    ],
  };

  // Same breakdown as the HTML stub: the review delta only ever covers the revenue
  // share; with piece work or hourly, each part gets its own row.
  const extras = m.pieces.length > 0 || m.hours.length > 0;
  const heroRows: [string, string][] = [];
  if (extras) heroRows.push(["Revenue share", pdfUsd(m.totals.linePayout)]);
  if (Math.abs(m.totals.delta) >= 0.005) {
    heroRows.push([
      extras ? "Share before review" : "Before HJG review",
      pdfUsd(m.totals.enginePayout),
    ]);
    heroRows.push([
      "HJG adjustments",
      `${m.totals.delta > 0 ? "+" : "−"}${pdfUsd(Math.abs(m.totals.delta))}`,
    ]);
  }
  if (m.pieces.length) heroRows.push(["Piece work", pdfUsd(m.piecesTotal)]);
  if (m.hours.length) heroRows.push(["Hourly work", pdfUsd(m.hourlyPay)]);
  const cards: PdfNode[] = [
    card("Eligible revenue", pdfUsd(m.totals.earned), [
      [`${m.totals.menteeCount} mentee${m.totals.menteeCount === 1 ? "" : "s"}`, `× ${pct}`],
    ]),
  ];
  if (m.pieces.length && m.hours.length)
    cards.push(
      card("Piece work + hourly", pdfUsd(round2(m.piecesTotal + m.hourlyPay)), [
        ["Piece work", pdfUsd(m.piecesTotal)],
        [`Hourly · ${fmtH(m.hoursTotal)}`, pdfUsd(m.hourlyPay)],
      ]),
    );
  else if (m.pieces.length)
    cards.push(
      card("Piece work", pdfUsd(m.piecesTotal), [
        [`${m.pieces.length} item${m.pieces.length === 1 ? "" : "s"}`, "paid per unit"],
      ]),
    );
  else if (m.hours.length)
    cards.push(
      card("Hourly work", pdfUsd(m.hourlyPay), [
        [fmtH(m.hoursTotal), m.hourlyMixedRates ? "rates vary" : `× ${pdfUsd(m.hourlyRate)}/h`],
      ]),
    );
  cards.push(card("Total payout", pdfUsd(m.totals.payout), heroRows, true));
  cards.push(
    card("HJG review", m.totals.adjustedCount ? String(m.totals.adjustedCount) : "—", [
      [m.totals.adjustedCount === 1 ? "line reviewed / adjusted" : "lines reviewed / adjusted", ""],
    ]),
  );

  const summaryBody: PdfNode[][] = [
    [
      th("Mentee", "left"),
      th("Engagement rate"),
      th("This month"),
      th("Rolled in"),
      th("Earned"),
      th("Payout"),
    ],
    ...m.rows.map((r) => [
      menteeNameCell(r),
      r.excluded ? { text: safe(r.tier), color: MUT, alignment: "right" } : num(safe(r.tier)),
      num(pdfUsd(r.thisMonth)),
      num(pdfUsd(r.rolledIn)),
      num(pdfUsd(r.earned)),
      num(pdfUsd(r.payout), true),
    ]),
    ...m.pieces.map(pieceSummaryRow),
    ...m.hours.map((e) => hourSummaryRow(e, m.hourlyRate)),
  ];
  const totalRow = summaryBody.length;
  summaryBody.push(
    [
      { text: "TOTAL", bold: true },
      "",
      num(pdfUsd(round2(included.reduce((t, r) => t + r.thisMonth, 0))), true),
      num(pdfUsd(round2(included.reduce((t, r) => t + r.rolledIn, 0))), true),
      num(pdfUsd(m.totals.earned), true),
      num(pdfUsd(m.totals.payout), true),
    ].map((c) => (typeof c === "string" ? { text: c } : c)),
  );

  const content: PdfNode[] = [
    header({
      kicker: "Mentor payment statement",
      monthLabel: m.monthLabel,
      sub: `Prepared by HJG · generated ${fmtD(m.generatedOn)}${m.reviewedAt ? ` · reviewed ${fmtD(m.reviewedAt.slice(0, 10))}` : ""}`,
      approved: m.approved,
      unsaved: m.unsavedChanges,
      paidTo: m.coachName,
      rateLine,
    }),
    cardsRow(cards),
    {
      table: {
        headerRows: 1,
        widths: ["*", 58, 62, 58, 62, 66],
        body: summaryBody,
      },
      layout: statementTableLayout(totalRow),
    },
  ];
  if (m.monthNote) content.push(noteBlock("Note from HJG:", m.monthNote));
  content.push(
    finePrint([
      { text: "How your pay is calculated. ", bold: true, color: INK },
      `You earn ${pct} of the mentoring-subscription revenue billed to your mentees. Each invoice pays out across two months: the portion of the month remaining on its billing day counts in its own month, and the rest rolls into the next — so "${m.monthLabel}" blends ${m.monthLabel}'s new invoices with ${m.prevMonthLabel}'s rolled-in portion. Non-mentoring charges (JumpStart supervision, setup fees, training) are not part of mentor pay. `,
      ...(m.pieces.length
        ? [
            "Piece-work items are paid flat per unit on top of that revenue share — quantity × rate each, listed in the summary table above. ",
          ]
        : []),
      ...(m.hours.length
        ? [
            "Hourly work is paid in full, separately from the revenue share — hours × the hourly rate, listed in the summary table above. ",
          ]
        : []),
      "The pages that follow show every invoice and every line item behind each number, including anything HJG adjusted in review.",
    ]),
  );
  content.push({
    text: "Breakdown — the invoices behind each number",
    fontSize: 13,
    bold: true,
    pageBreak: "before",
    margin: [0, 4, 0, 10],
  });
  for (const r of m.rows) content.push(menteeBreakdown(r, m, pct));
  content.push(
    finePrint(["Questions about any line? Reply to this statement and HJG will walk through it."]),
  );

  return { ...baseDoc(title, m.approved), content };
}

// --- hourly (timesheet) stub ------------------------------------------------

export function hourlyStubPdfDoc(m: HourlyStubModel): PdfDocDefinition {
  const title = `${m.staffName} — ${m.monthLabel} pay stub`;
  const rateCol = m.mixedRates;
  const cols = rateCol ? 5 : 4;
  const hasAdj = Math.abs(m.adjustment) >= 0.005;

  const heroRows: [string, string][] = [];
  if (m.pieces.length || hasAdj) heroRows.push(["Hours", pdfUsd(m.base)]);
  if (m.pieces.length) heroRows.push(["Piece work", pdfUsd(m.piecesTotal)]);
  if (hasAdj) heroRows.push(["Adjustment", pdfUsd(m.adjustment)]);
  const cards: PdfNode[] = [
    card("Hours", fmtH(m.hours), [
      [
        `${m.entries.length} timesheet line${m.entries.length === 1 ? "" : "s"}`,
        m.mixedRates ? "rates vary" : `× ${pdfUsd(m.rate)}/h`,
      ],
    ]),
  ];
  if (m.pieces.length)
    cards.push(
      card("Piece work", pdfUsd(m.piecesTotal), [
        [
          `${m.pieces.length} item${m.pieces.length === 1 ? "" : "s"}`,
          `${fmtQty(m.piecesQty)} unit${m.piecesQty === 1 ? "" : "s"}`,
        ],
      ]),
    );
  cards.push(card("Total payout", pdfUsd(m.total), heroRows, true));

  const head: PdfNode[] = [th("Date", "left"), th("Work", "left"), th("Hours")];
  if (rateCol) head.push(th("Rate"));
  head.push(th("Amount"));
  const body: PdfNode[][] = [head];
  for (const e of m.entries) {
    const r = entryRate(e, m.rate);
    const row: PdfNode[] = [e.date ? fmtD(e.date) : "—", safe(e.label || "—"), num(fmtH(e.hours))];
    if (rateCol)
      row.push({
        text: [`${pdfUsd(r)}/h`, ...(r !== m.rate ? ["  ", tag("custom", "warn")] : [])],
        alignment: "right",
      });
    row.push(num(pdfUsd(entryAmount(e, m.rate))));
    body.push(row);
  }
  if (m.pieces.length) {
    const headCell: PdfNode = {
      text: `Piece work${rateCol ? "" : " (quantity × rate each)"}`,
      bold: true,
      colSpan: cols,
      margin: [0, 4, 0, 0],
    };
    body.push([headCell, ...Array.from({ length: cols - 1 }, () => "")]);
    for (const p of m.pieces) {
      const row: PdfNode[] = [
        p.date ? fmtD(p.date) : "—",
        { text: [safe(p.label || "—"), "  ", tag("piece work", "good")] },
        num(rateCol ? `${fmtQty(p.qty)} ×` : `${fmtQty(p.qty)} × ${pdfUsd(p.unitRate)}`),
      ];
      if (rateCol) row.push(num(`${pdfUsd(p.unitRate)} ea`));
      row.push(num(pdfUsd(pieceAmount(p))));
      body.push(row);
    }
  }
  if (hasAdj) {
    const row: PdfNode[] = [
      "—",
      `Adjustment${m.adjustmentNote ? ` — ${safe(m.adjustmentNote)}` : ""}`,
      "",
    ];
    if (rateCol) row.push("");
    row.push(num(pdfUsd(m.adjustment)));
    body.push(row);
  }
  if (body.length === 1) {
    body.push([
      { text: "No timesheet lines.", color: MUT, colSpan: cols },
      ...Array.from({ length: cols - 1 }, () => ""),
    ]);
  }
  const totalRow = body.length;
  const total: PdfNode[] = [{ text: "TOTAL", bold: true }, "", num(fmtH(m.hours), true)];
  if (rateCol) total.push("");
  total.push(num(pdfUsd(m.total), true));
  body.push(total);

  const widths = rateCol ? [62, "*", 52, 78, 70] : [62, "*", 70, 76];
  const content: PdfNode[] = [
    header({
      kicker: "Staff payment statement",
      monthLabel: m.monthLabel,
      sub: `Prepared by HJG · generated ${fmtD(m.generatedOn)}`,
      approved: m.approved,
      unsaved: m.unsavedChanges,
      paidTo: m.staffName,
      rateLine: `${m.mixedRates ? "Default rate" : "Hourly rate"} ${pdfUsd(m.rate)}/h`,
    }),
    cardsRow(cards),
    { table: { headerRows: 1, widths, body }, layout: statementTableLayout(totalRow) },
  ];
  if (m.notes) content.push(noteBlock("Note from HJG:", m.notes));
  content.push(
    finePrint([
      `Hours are taken from the time sheet you submitted for ${m.monthLabel}; the total is each line's hours × its rate${m.mixedRates ? " (some work is paid at a different rate — the Rate column shows which)" : ""}${m.pieces.length ? ", plus the piece-work items listed" : ""}${hasAdj ? ", plus the adjustment shown" : ""}. `,
      "Questions about any line? Reply to this statement and HJG will walk through it with you.",
    ]),
  );
  return { ...baseDoc(title, m.approved), content };
}
