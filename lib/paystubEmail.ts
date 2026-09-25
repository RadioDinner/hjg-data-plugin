// Pay stubs by EMAIL (session 021) — the pure rules shared by the send endpoint
// (api/send-paystub.ts), the browser (who a stub will go to), and verify §30.
//
//   • WHO a stub goes to: a mentor's pay-stub email (coach_settings.pay_email)
//     wins, else their CoachAccountable email (ca_coaches.email). An hourly staff
//     member's own email (staff_pay_profiles.email) wins, else their linked
//     coach's address by the mentor rule. The SERVER resolves this itself — the
//     browser never supplies a recipient.
//   • WHAT the email says: a short note naming the month; the PDF stub rides as
//     an attachment. Amounts stay OUT of the subject and body on purpose (phone
//     lock-screen previews) — the numbers live in the PDF.
//   • Whether a stub still matches its approved build (totals within a cent).
//
// A LEAF module on purpose (no relative imports): the Vercel functions are
// native ESM and the browser bundles it too, so it must resolve under both.

export type PayEmailSource = "pay-email" | "coachaccountable" | "staff-profile";

export interface ResolvedPayEmail {
  email: string;
  source: PayEmailSource;
  valid: boolean;
}

// Human wording for where an address came from (UI + confirm dialog).
export const PAY_EMAIL_SOURCE_LABEL: Record<PayEmailSource, string> = {
  "pay-email": "pay-stub email set in Admin → Mentor capacity",
  coachaccountable: "their CoachAccountable email",
  "staff-profile": "email on their Hourly staff profile",
};

// One plain address — no display name, no lists, nothing a mail header could be
// split on. Deliberately stricter than RFC 5322: a pay stub must reach exactly
// one person.
export function isValidEmail(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (!s || s.length > 254) return false;
  if (/[\s<>(),;:"'\\[\]]/.test(s)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return false;
  const domain = s.slice(at + 1);
  if (domain.length < 3 || !domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return true;
}

// Trimmed + lower-cased, or null when blank. (Storage keeps what staff typed;
// comparisons and sends use this.)
export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return s ? s : null;
}

function pick(email: string | null | undefined, source: PayEmailSource): ResolvedPayEmail | null {
  const e = normalizeEmail(email);
  return e ? { email: e, source, valid: isValidEmail(e) } : null;
}

// A mentor: their pay-stub email override, else their CoachAccountable email.
// A typed override WINS even when it's malformed (reported valid:false) — silently
// falling back to another address would email someone the reviewer steered away from.
export function resolveMentorPayEmail(input: {
  payEmail?: string | null;
  caEmail?: string | null;
}): ResolvedPayEmail | null {
  return pick(input.payEmail, "pay-email") ?? pick(input.caEmail, "coachaccountable");
}

// Hourly staff: their own profile email, else their linked coach's address.
export function resolveHourlyPayEmail(input: {
  profileEmail?: string | null;
  linkedCoach?: { payEmail?: string | null; caEmail?: string | null } | null;
}): ResolvedPayEmail | null {
  return (
    pick(input.profileEmail, "staff-profile") ??
    (input.linkedCoach ? resolveMentorPayEmail(input.linkedCoach) : null)
  );
}

// An archived stub is emailable only while it still matches the APPROVED build
// it came from — same total to the cent (a hair of float slack). A reopened or
// re-approved-at-a-different-total build makes the old stub stale.
export const PAYSTUB_TOTAL_TOLERANCE = 0.01;
export function totalsMatch(a: number, b: number): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= PAYSTUB_TOTAL_TOLERANCE + 1e-9;
}

// Double-click / second-tab guard: the same person + period + address already
// got a stub within this window.
export const RESEND_GUARD_MS = 2 * 60 * 1000;
export function sentRecently(
  log: { to_email: string; status: string; created_at: string }[],
  toEmail: string,
  nowMs: number,
): boolean {
  const want = normalizeEmail(toEmail);
  return log.some(
    (r) =>
      r.status === "sent" &&
      normalizeEmail(r.to_email) === want &&
      nowMs - Date.parse(r.created_at) < RESEND_GUARD_MS &&
      nowMs - Date.parse(r.created_at) >= -RESEND_GUARD_MS,
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export function periodLabel(ym: string): string {
  const [y, m] = String(ym).split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : String(ym);
}

export function firstNameOf(name: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

// "HJG-pay-stub-Harry-Shenk-2026-06.pdf" — ASCII-safe for every mail client.
export function paystubPdfFilename(staffName: string, ym: string): string {
  const who =
    (staffName ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "staff";
  const period = /^\d{4}-\d{2}$/.test(ym) ? ym : "period";
  return `HJG-pay-stub-${who}-${period}.pdf`;
}

const escHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface PaystubEmailContent {
  subject: string;
  html: string;
  text: string;
}

// The message around the PDF. Email-client-safe HTML: one table, inline styles,
// literal colors, no stylesheet (Gmail and Outlook drop most of the print CSS).
export function paystubEmailContent(input: {
  staffName: string;
  ym: string;
  kind: "mentor" | "hourly";
}): PaystubEmailContent {
  const month = periodLabel(input.ym);
  const first = firstNameOf(input.staffName);
  const what = input.kind === "mentor" ? "mentor payment statement" : "pay stub";
  const subject = `Your ${month} pay stub from HJG`;
  const text = [
    `Hi ${first},`,
    "",
    `Your ${what} for ${month} is attached as a PDF. It shows how the total was calculated, line by line.`,
    "",
    "Questions about any line? Just reply to this email and HJG will walk through it with you.",
    "",
    "— HJG",
  ].join("\n");
  const p = (s: string, extra = "") =>
    `<p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#2f3226;${extra}">${s}</p>`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f7f3e8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f3e8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #dcd7c4;">
<tr><td style="height:8px;line-height:8px;font-size:0;background-color:#77855c;">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px 28px;">
${p(`<span style="font-size:11px;letter-spacing:2px;font-weight:bold;color:#5c6a45;text-transform:uppercase;">${input.kind === "mentor" ? "Mentor payment statement" : "Staff payment statement"}</span>`, "margin-bottom:6px;")}
${p(`<span style="font-size:24px;line-height:30px;">${escHtml(month)}</span>`, "margin-bottom:18px;")}
${p(`Hi ${escHtml(first)},`)}
${p(`Your ${what} for <strong>${escHtml(month)}</strong> is attached as a PDF. It shows how the total was calculated, line by line.`)}
${p("Questions about any line? Just reply to this email and HJG will walk through it with you.")}
${p("— HJG", "margin-bottom:8px;")}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  return { subject, html, text };
}
