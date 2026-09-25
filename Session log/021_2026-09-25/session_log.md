# Session 021 — 2026-09-25 — Q&A: emailing pay stubs (no code)

Branch: `claude/wizardly-planck-9vzspj` (started at `main` = `2cb5865`, v0.10.0). No app
code changed; version stays **0.10.0**.

## What shipped

- (this commit) — session folder, prompt history, this log, HANDOFF note.

## The question

"How hard would it be to put an email address on file with each staff member and mentor,
and automatically email them their paystub when I mark it as complete? Or click a button to
send them the pay stubs?"

## Answer given (summary)

**Moderate. The button version is about one working session. Auto-send is a small addition
after that.** The email send itself is easy. The work is in three places: an email-safe
renderer, a locked-down send endpoint, and the user's provider + DNS setup.

What already exists:
- Mentor emails are already mirrored: `ca_coaches.email` ← CA `Coach.getAll.email`
  (`lib/sync.ts:267`, `docs/coachaccountable-api.md:591`). It is the CA login email, so
  an override field is advisable.
- Every printed stub is archived as its exact HTML in `paystubs` (migration 9970), so the
  server can email the archived copy instead of re-deriving payroll server-side.
- `withApi` (`lib/http.ts`) already gives authenticated serverless endpoints. Mentor builds
  already have Approve + Payment sent (Melio ref) states.

What's missing:
1. No email sending at all (no provider, key, or code).
2. Hourly staff (`staff_pay_profiles`) have no email column. Archived hourly stubs aren't
   linked to a profile (only `staff_name`). This needs migration **9962** (next number).
3. The stub HTML is print-oriented (`STUB_CSS` uses CSS variables + flexbox, shared by
   mentor and hourly stubs). Gmail and Outlook-Windows don't support `var()`. Gmail strips
   flex properties other than `display:flex`. The Gmail app on non-Google accounts ignores
   `<style>`. So the stub needs a second, email-safe (table + inline style) renderer from
   the same model. Example: `th { background:var(--olive); color:#fff }` would likely
   render white-on-white in Gmail.
4. Security: `checkUser` only checks for a valid session, and tab permissions are
   client-side only (`lib/permissions.ts`, fail-open). The send endpoint must resolve the
   recipient server-side (never from the request), send only approved archived stubs, and
   check the caller's role server-side.

Recommendations given:
- Don't auto-send on **Approve**, because approved builds can be reopened and an email
  can't be recalled. If automated, trigger on **Payment sent**, preferably as a
  pre-checked "Email the stub to <address>" checkbox in the existing Payment-sent dialog,
  so the address is visible on every send. Hourly builds have no Payment-sent step, so
  they get the button only or a new step.
- Always keep a manual "Email stub" button (next to Print + in History for resends).
- Format: stub **in the email body** (recommended). A PDF attachment is the hardest option
  (headless Chromium in a Vercel function, 250 MB limit), so it's deferred. An `.html`
  attachment was rejected because HTML attachments are a top phishing format.
- Provider: **Resend** (free plan 3,000/mo, 100/day; DNS SPF/DKIM, subdomain
  recommended). Postmark free = 100/mo then $15/mo. SendGrid dropped its permanent free
  plan in 2025. **Correction (turn 2):** turn 1 said the free plan allows 1 domain, based
  on a stale Resend knowledge-base page. Resend's changelog says free teams now get **3**.
- Side note: letting mentors log in to see their own stubs instead is a much bigger job,
  because every table's RLS is "any signed-in user reads everything".

Sources could not be fetched directly (egress policy blocked resend.com, caniemail.com,
support.google.com). Facts came from web-search summaries, and the user was told to
re-check pricing on the vendor page.

## Turn 2: reuse the Plain Exchange Resend account, or make a new one?

The user already has a Resend account (GitHub login) that they use to send email for
The Plain Exchange.

**Recommendation:** a separate Resend account for HJG, signed up with an HJG-owned email
address. Reasons:
- Resend keeps sent-email data for 30 days. Mentor stubs include mentee names and
  invoice amounts, so anyone on the Plain Exchange team could read them.
- The bounce (<4%) and spam (<0.08%) limits apply account-wide, so a problem on either
  side pauses the other's sending.
- The 100/day and 3,000/month quota is shared.
- HJG's payroll email shouldn't hang on a personal GitHub login tied to another business.

Options laid out:
1. Same team: free now that free teams get 3 domains. Must use a sending-only key
   restricted to HJG's domain.
2. Same login, new team: new teams must start on a paid plan (Pro $20/mo). Poor value at
   HJG's volume.
3. New account (recommended): Resend's AUP forbids multiple accounts meant to get around
   quotas. A separate org account isn't that, since HJG's volume fits the existing
   quota, but the user was told to confirm with Resend support if they want certainty.

Either way: HJG gets its own sending-only, domain-restricted API key, stored only in
HJG's Vercel project.

## Open questions / next step (awaiting the user)

1. Trigger: button only, or button + Payment-sent checkbox (recommended)?
2. Format: email body (recommended) or PDF?
3. Hourly staff: button only, or add a Payment-sent step to hourly pay?
4. Provider/domain: Resend OK? Which sending domain, and does the user control its DNS?

If they say build it, the planned pieces are:
- migration 9962: `coach_settings.pay_email`, `staff_pay_profiles.email`,
  `paystubs.profile_id`, and a `paystub_emails` send log
- email renderers for the mentor + hourly stubs, with verify checks
- `api/send-paystub.ts`
- UI: an email button + confirm dialog, email fields in Admin (mentors) and the hourly
  profile editor, and a sent status in History
- help text and a minor version bump (0.11.0)
