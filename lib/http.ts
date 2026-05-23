import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CAError, CredentialsMissingError } from "./ca";
import { BudgetExhaustedError } from "./budget";

const ALLOWED_ORIGINS = (process.env.HJG_CORS_ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isProd = process.env.VERCEL_ENV === "production";

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = (req.headers.origin as string) || "";
  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-hjg-token");
}

function tokenFrom(req: VercelRequest): string | undefined {
  const header = req.headers["x-hjg-token"];
  if (typeof header === "string" && header) return header;
  const q = req.query.token;
  if (typeof q === "string" && q) return q;
  return undefined;
}

/** Returns null if authorized, or an error to send. */
function checkAuth(req: VercelRequest): { status: number; message: string } | null {
  const expected = process.env.HJG_API_TOKEN;
  if (!expected) {
    // Fail closed in production so a forgotten token never silently opens the API.
    if (isProd) {
      return { status: 500, message: "Server auth is not configured" };
    }
    return null; // local dev convenience
  }
  if (tokenFrom(req) === expected) return null;
  return { status: 401, message: "Unauthorized" };
}

export interface ApiOptions {
  /** s-maxage seconds for successful responses. 0 = no-store. */
  cacheTtl?: number;
  /** Skip the bearer-token check (e.g. /api/health). */
  noAuth?: boolean;
  /** Allowed HTTP methods (default ["GET"]). OPTIONS is always handled. */
  methods?: string[];
}

export function sendError(
  res: VercelResponse,
  status: number,
  message: string,
  detail?: unknown
): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: true, status, message, detail });
}

function mapError(e: unknown): { status: number; message: string; detail?: unknown } {
  if (e instanceof BudgetExhaustedError) {
    return { status: 503, message: "Daily API budget exhausted; no cached data available yet" };
  }
  if (e instanceof CredentialsMissingError) {
    return { status: 500, message: "CoachAccountable credentials are not configured" };
  }
  if (e instanceof CAError) {
    const c = e.caCode;
    if (c >= 100 && c <= 199) return { status: 502, message: "CoachAccountable upstream error", detail: { caCode: c } };
    if (c >= 300 && c <= 499) return { status: 400, message: e.message, detail: { caCode: c } };
    return { status: 502, message: "CoachAccountable API error", detail: { caCode: c } };
  }
  return { status: 500, message: "Internal error" };
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

export function withApi(handler: Handler, opts: ApiOptions = {}) {
  const methods = opts.methods ?? ["GET"];
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (!methods.includes(req.method ?? "GET")) {
      sendError(res, 405, "Method not allowed");
      return;
    }

    if (!opts.noAuth) {
      const authErr = checkAuth(req);
      if (authErr) {
        sendError(res, authErr.status, authErr.message);
        return;
      }
    }

    try {
      // Default success cache header; handlers may override before writing.
      if (opts.cacheTtl && opts.cacheTtl > 0) {
        res.setHeader(
          "Cache-Control",
          `s-maxage=${opts.cacheTtl}, stale-while-revalidate=${opts.cacheTtl * 2}`
        );
      } else {
        res.setHeader("Cache-Control", "no-store");
      }
      await handler(req, res);
    } catch (e) {
      const mapped = mapError(e);
      if (mapped.status === 503) res.setHeader("Retry-After", "300");
      sendError(res, mapped.status, mapped.message, mapped.detail);
    }
  };
}

export function authEnabled(): boolean {
  return Boolean(process.env.HJG_API_TOKEN);
}
