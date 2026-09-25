import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi, sendError, requestUser } from "../lib/http.js";
import { getAdminClient } from "../lib/supabase-admin.js";
import { resolveAllowedTabs } from "../lib/permissions.js";
import {
  isValidEmail,
  paystubEmailContent,
  paystubPdfFilename,
  resolveHourlyPayEmail,
  resolveMentorPayEmail,
  sentRecently,
  totalsMatch,
  RESEND_GUARD_MS,
  type ResolvedPayEmail,
} from "../lib/paystubEmail.js";

// POST /api/send-paystub { paystubId } — email one ARCHIVED, APPROVED pay stub
// (its stored PDF) to the person it belongs to, via Resend.
//
// The browser only names WHICH archived stub; everything else is decided here:
//   • the caller must be signed in AND allowed on the Pay staff tab (app_users,
//     same rules as the browser — lib/permissions);
//   • the stub must be approved, carry a PDF, and still match its APPROVED build
//     (same total to the cent) — a reopened / changed build can't be emailed;
//   • the recipient is looked up from the database, never taken from the request;
//   • the same person + month + address can't be emailed twice within 2 minutes.
// Every attempt (sent or failed) lands in paystub_emails (migration 9962).
//
// Env: RESEND_API_KEY (a Resend key, ideally "Sending access" restricted to the
// sending domain), PAYSTUB_FROM (e.g. "HJG Pay <pay@send.example.org>" on that
// verified domain), PAYSTUB_REPLY_TO (optional; where replies should land).

const RESEND_URL = "https://api.resend.com/emails";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StubRow {
  id: string;
  kind: "mentor" | "hourly";
  staff_name: string;
  coach_id: number | null;
  profile_id: string | null;
  period_month: string;
  status: string;
  total: number | string | null;
  pdf_base64: string | null;
}

type Admin = ReturnType<typeof getAdminClient>;

// Mirrors the browser: no app_users row (or no table yet) => every tab.
async function mayUsePayStaff(admin: Admin, email: string | null): Promise<boolean> {
  const want = (email ?? "").trim().toLowerCase();
  const { data, error } = await admin
    .from("app_users")
    .select("email,role,allowed_tabs,is_active")
    .limit(500);
  if (error || !data) return true;
  const hit = (data as Record<string, unknown>[]).find(
    (r) =>
      String(r.email ?? "")
        .trim()
        .toLowerCase() === want,
  );
  if (!hit) return true;
  return resolveAllowedTabs({
    role: (hit.role as string | null) ?? null,
    allowedTabs: Array.isArray(hit.allowed_tabs) ? (hit.allowed_tabs as string[]) : null,
    isActive: hit.is_active !== false,
  }).has("paystaff");
}

// A coach's two candidate addresses; the pure rule in lib/paystubEmail picks one.
async function coachEmails(
  admin: Admin,
  coachId: number,
): Promise<{ payEmail: string | null; caEmail: string | null }> {
  const [settings, coach] = await Promise.all([
    admin.from("coach_settings").select("pay_email").eq("coach_id", coachId).maybeSingle(),
    admin.from("ca_coaches").select("email").eq("id", coachId).maybeSingle(),
  ]);
  if (coach.error) throw new Error(coach.error.message);
  // settings.error = migration 9962 not applied yet: fall back to the CA email.
  const payEmail = settings.error
    ? null
    : ((settings.data as { pay_email?: string | null } | null)?.pay_email ?? null);
  const caEmail = (coach.data as { email?: string | null } | null)?.email ?? null;
  return { payEmail, caEmail };
}

export default withApi(
  async (req: VercelRequest, res: VercelResponse) => {
    const user = requestUser(req);
    const body = (typeof req.body === "string" ? safeJson(req.body) : req.body) as {
      paystubId?: unknown;
    } | null;
    const paystubId = typeof body?.paystubId === "string" ? body.paystubId : "";
    if (!UUID.test(paystubId)) return sendError(res, 400, "paystubId (a stub id) is required");

    const admin = getAdminClient();
    if (!(await mayUsePayStaff(admin, user?.email ?? null)))
      return sendError(res, 403, "Your account doesn't have access to Pay staff");

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.PAYSTUB_FROM?.trim();
    const replyTo = process.env.PAYSTUB_REPLY_TO?.trim() || null;
    if (!apiKey || !from)
      return sendError(
        res,
        503,
        "Email isn't set up yet — add RESEND_API_KEY and PAYSTUB_FROM in Vercel, then redeploy",
      );
    if (replyTo && !isValidEmail(replyTo))
      return sendError(res, 503, "PAYSTUB_REPLY_TO in Vercel isn't a valid email address");

    // --- the archived stub ---------------------------------------------------
    const stubRes = await admin
      .from("paystubs")
      .select("id,kind,staff_name,coach_id,profile_id,period_month,status,total,pdf_base64")
      .eq("id", paystubId)
      .maybeSingle();
    if (stubRes.error)
      return sendError(
        res,
        500,
        `Couldn't read the stub archive (${stubRes.error.message}) — is migration 9962_paystub_email.sql applied?`,
      );
    const stub = stubRes.data as StubRow | null;
    if (!stub) return sendError(res, 404, "That archived stub no longer exists");
    if (stub.status !== "approved")
      return sendError(res, 409, "Only APPROVED pay stubs can be emailed — not review copies");
    if (!stub.pdf_base64)
      return sendError(
        res,
        409,
        "This archived stub has no PDF — email it from Build payout or Hourly staff",
      );
    const total = Number(stub.total) || 0;

    // --- still matches its approved build? ---------------------------------
    let recipient: ResolvedPayEmail | null;
    if (stub.kind === "mentor") {
      if (stub.coach_id == null) return sendError(res, 409, "This stub isn't linked to a mentor");
      const b = await admin
        .from("payout_builds")
        .select("status,built_total")
        .eq("coach_id", stub.coach_id)
        .eq("service_month", stub.period_month)
        .maybeSingle();
      if (b.error) throw new Error(b.error.message);
      const build = b.data as { status: string; built_total: number | string } | null;
      if (!build || build.status !== "approved")
        return sendError(
          res,
          409,
          "The build for this mentor and month isn't approved any more — approve it again, then email from Build payout",
        );
      if (!totalsMatch(Number(build.built_total), total))
        return sendError(
          res,
          409,
          `This stub (${usd(total)}) no longer matches the approved build (${usd(Number(build.built_total))}) — email a fresh stub from Build payout`,
        );
      recipient = resolveMentorPayEmail(await coachEmails(admin, stub.coach_id));
    } else {
      if (!stub.profile_id)
        return sendError(
          res,
          409,
          "This stub isn't linked to a staff profile — email it from Hourly staff",
        );
      const b = await admin
        .from("staff_pay_builds")
        .select("status,total")
        .eq("profile_id", stub.profile_id)
        .eq("period_month", stub.period_month)
        .maybeSingle();
      if (b.error) throw new Error(b.error.message);
      const build = b.data as { status: string; total: number | string } | null;
      if (!build || build.status !== "approved")
        return sendError(
          res,
          409,
          "This timesheet isn't approved any more — approve it again, then email from Hourly staff",
        );
      if (!totalsMatch(Number(build.total), total))
        return sendError(
          res,
          409,
          `This stub (${usd(total)}) no longer matches the approved timesheet (${usd(Number(build.total))}) — email a fresh stub from Hourly staff`,
        );
      const p = await admin
        .from("staff_pay_profiles")
        .select("email,coach_id")
        .eq("id", stub.profile_id)
        .maybeSingle();
      if (p.error) throw new Error(p.error.message);
      const prof = p.data as { email?: string | null; coach_id?: number | null } | null;
      recipient = resolveHourlyPayEmail({
        profileEmail: prof?.email ?? null,
        linkedCoach: prof?.coach_id != null ? await coachEmails(admin, prof.coach_id) : null,
      });
    }
    if (!recipient) return sendError(res, 422, `No email address on file for ${stub.staff_name}`);
    if (!recipient.valid)
      return sendError(
        res,
        422,
        `The email on file for ${stub.staff_name} (${recipient.email}) isn't a valid address`,
      );

    // --- double-send guard ----------------------------------------------------
    const since = new Date(Date.now() - RESEND_GUARD_MS).toISOString();
    let recent = admin
      .from("paystub_emails")
      .select("to_email,status,created_at")
      .eq("kind", stub.kind)
      .eq("period_month", stub.period_month)
      .eq("status", "sent")
      .gte("created_at", since);
    recent =
      stub.kind === "mentor"
        ? recent.eq("coach_id", stub.coach_id as number)
        : recent.eq("profile_id", stub.profile_id as string);
    const recentRes = await recent;
    if (recentRes.error)
      return sendError(
        res,
        500,
        `Couldn't read the email log (${recentRes.error.message}) — is migration 9962_paystub_email.sql applied?`,
      );
    if (
      sentRecently(
        (recentRes.data ?? []) as { to_email: string; status: string; created_at: string }[],
        recipient.email,
        Date.now(),
      )
    )
      return sendError(
        res,
        409,
        `${stub.staff_name}'s stub was emailed to ${recipient.email} moments ago — wait a couple of minutes before sending it again`,
      );

    // --- send ------------------------------------------------------------------
    const content = paystubEmailContent({
      staffName: stub.staff_name,
      ym: stub.period_month,
      kind: stub.kind,
    });
    const payload: Record<string, unknown> = {
      from,
      to: [recipient.email],
      subject: content.subject,
      html: content.html,
      text: content.text,
      attachments: [
        {
          filename: paystubPdfFilename(stub.staff_name, stub.period_month),
          content: stub.pdf_base64,
          content_type: "application/pdf",
        },
      ],
    };
    if (replyTo) payload.reply_to = replyTo;

    let providerId: string | null = null;
    let failure: string | null = null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const r = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const out = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
      if (r.ok && out.id) providerId = out.id;
      else failure = `Resend ${r.status}: ${out.message ?? r.statusText ?? "unknown error"}`;
    } catch (e) {
      failure =
        (e as Error)?.name === "AbortError"
          ? "The email service didn't answer within 20 seconds"
          : `Couldn't reach the email service: ${String(e)}`;
    } finally {
      clearTimeout(timer);
    }

    const sentAt = new Date().toISOString();
    const log = await admin.from("paystub_emails").insert({
      paystub_id: stub.id,
      kind: stub.kind,
      coach_id: stub.coach_id,
      profile_id: stub.profile_id,
      staff_name: stub.staff_name,
      period_month: stub.period_month,
      to_email: recipient.email,
      status: failure ? "failed" : "sent",
      provider_id: providerId,
      error: failure,
      sent_by: user?.id ?? null,
      sent_by_email: user?.email ?? null,
      created_at: sentAt,
    });

    if (failure) return sendError(res, 502, `Email not sent — ${failure}`);
    res.status(200).json({
      ok: true,
      to: recipient.email,
      source: recipient.source,
      providerId,
      sentAt,
      logged: !log.error,
    });
  },
  { methods: ["POST"], auth: "user", cacheTtl: 0 },
);

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function usd(n: number): string {
  return `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
