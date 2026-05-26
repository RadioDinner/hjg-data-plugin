import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CAError, CredentialsMissingError } from "./ca";
import { BudgetExhaustedError } from "./budget";
import { SyncInProgressError } from "./sync";
import { getAdminClient, SupabaseConfigError } from "./supabase-admin";

const ALLOWED_ORIGINS = (process.env.HJG_CORS_ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = (req.headers.origin as string) || "";
  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-sync-secret");
}

function bearer(req: VercelRequest): string | undefined {
  const h = req.headers.authorization;
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7).trim() || undefined;
  return undefined;
}

// Verifies the caller is a signed-in Supabase user. Returns null when authorized,
// or an error to send.
async function checkUser(req: VercelRequest): Promise<{ status: number; message: string } | null> {
  const token = bearer(req);
  if (!token) return { status: 401, message: "Sign in required" };
  const { data, error } = await getAdminClient().auth.getUser(token);
  if (error || !data.user) return { status: 401, message: "Invalid or expired session" };
  return null;
}

export interface ApiOptions {
  /** s-maxage seconds for successful responses. 0 / omitted = no-store. */
  cacheTtl?: number;
  /** Auth requirement. Default "user" (a valid Supabase session). */
  auth?: "none" | "user";
  /** Also accept a matching x-sync-secret header (for the scheduled-sync cron). */
  allowCronSecret?: boolean;
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
    return { status: 503, message: "Daily CoachAccountable call budget exhausted" };
  }
  if (e instanceof SyncInProgressError) {
    return { status: 409, message: "A sync is already running" };
  }
  if (e instanceof CredentialsMissingError) {
    return { status: 500, message: "CoachAccountable credentials are not configured" };
  }
  if (e instanceof SupabaseConfigError) {
    return { status: 500, message: "Supabase server credentials are not configured" };
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
  const auth = opts.auth ?? "user";
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

    if (auth !== "none") {
      let authorized = false;
      if (opts.allowCronSecret) {
        const secret = process.env.SYNC_CRON_SECRET;
        const provided = req.headers["x-sync-secret"];
        if (secret && typeof provided === "string" && provided === secret) authorized = true;
      }
      if (!authorized) {
        try {
          const authErr = await checkUser(req);
          if (authErr) {
            sendError(res, authErr.status, authErr.message);
            return;
          }
        } catch (e) {
          const mapped = mapError(e);
          sendError(res, mapped.status, mapped.message, mapped.detail);
          return;
        }
      }
    }

    try {
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
