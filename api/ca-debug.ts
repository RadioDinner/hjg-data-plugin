import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi } from "../lib/http.js";

// TEMPORARY diagnostic. Makes one read-only CoachAccountable call and returns
// the raw response shape so we can confirm how list data is nested. Remove once
// the sync parser is confirmed. auth:"none" so it can be opened directly in a
// browser — DELETE this file once debugging is done.
//   /api/ca-debug                      -> Coach.getAll
//   /api/ca-debug?fn=Client.getAll
//   /api/ca-debug?fn=Appointment.getAll&dateFrom=2026-01-01&dateTo=2026-12-31

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function shapeOf(v: unknown, depth = 0): unknown {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    return { _type: "array", length: v.length, first: v.length ? shapeOf(v[0], depth + 1) : null };
  }
  if (typeof v === "object") {
    if (depth > 2) return "object(…)";
    const keys = Object.keys(v as object);
    const sample: Record<string, unknown> = {};
    for (const k of keys.slice(0, 25)) {
      sample[k] = depth < 2 ? shapeOf((v as Record<string, unknown>)[k], depth + 1) : typeof (v as Record<string, unknown>)[k];
    }
    return { _type: "object", keys, sample };
  }
  return typeof v;
}

export default withApi(
  async (req: VercelRequest, res: VercelResponse) => {
    const id = process.env.CA_API_ID;
    const key = process.env.CA_API_KEY;
    if (!id || !key) {
      res.status(200).json({ ok: false, reason: "CA_API_ID / CA_API_KEY not set on the server" });
      return;
    }

    const fn = str(req.query.fn) ?? "Coach.getAll";
    const body = new URLSearchParams();
    body.set("APIID", id);
    body.set("APIKey", key);
    body.set("a", fn);
    body.set("includeInactive", "true");
    const df = str(req.query.dateFrom);
    const dt = str(req.query.dateTo);
    if (df) body.set("dateFrom", df);
    if (dt) body.set("dateTo", dt);

    const r = await fetch("https://www.coachaccountable.com/API/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await r.text();
    let json: unknown = null;
    let parseError: string | null = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      parseError = String(e);
    }

    res.status(200).json({
      ok: true,
      fn,
      httpStatus: r.status,
      parseError,
      shape: json === null ? null : shapeOf(json),
      rawTruncated: text.slice(0, 6000),
    });
  },
  { auth: "none", cacheTtl: 0 }
);
