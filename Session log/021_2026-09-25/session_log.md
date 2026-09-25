# Session 021 — 2026-09-25 — Email pay stubs (PDF) + hourly Payment sent (v0.11.0)

Branch: `claude/wizardly-planck-9vzspj` (started at `main` = `2cb5865`, v0.10.0).
Version bumped **0.10.0 → 0.11.0** on the branch. **Not merged to `main`**; that
waits on the user's word.

## What shipped

- `52ac018` — turn 1: Q&A on emailing pay stubs; session folder, log, HANDOFF note.
- `ec558d6` — turn 2: Resend account advice; corrected the free-plan domain count.
- (this commit) — turn 3: **the feature** (v0.11.0), see "Turn 3" below.

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

## Turn 3: "I made a new account, which one of these do you need" (+ build)

The user made a **new Resend account** (following turn 2's advice) and asked which
language snippet on Resend's onboarding screen I need. **Answer:** none. I write the
code, and the server calls Resend's REST API directly (what the cURL tab shows), so no
SDK or snippet is needed. I also warned them **not to paste the snippet or "Copy for
AI" output**, since it can contain the live `re_…` key; the key belongs only in Vercel env
vars. Setup steps given: verify the domain (subdomain), create a Sending-access key
restricted to it, and add `RESEND_API_KEY` in Vercel (Production + Preview), then
redeploy.

**Decisions (AskUserQuestion):** trigger = **Button only** · format = **PDF
attachment** · hourly staff = **Add a Payment-sent step** · **Yes, start building**.
Note: they chose PDF over the recommended email-body option, and button-only over the
recommended Payment-sent checkbox. Both were built as chosen.

**Built** (details in HANDOFF START HERE):
- Migration `9962_paystub_email.sql`: `coach_settings.pay_email`,
  `staff_pay_profiles.email`, `staff_pay_builds.payment_sent_at/_ref`,
  `paystubs.profile_id/pdf_base64/has_pdf` (generated), and `paystub_emails` (log,
  service-role writes only).
- `lib/paystubEmail.ts` (pure leaf: address rules, validation, totals match, resend
  guard, email content with no amounts, filename).
- `lib/payStubPdf.ts` (pure pdfmake layouts for mentor + hourly stubs from the
  existing stub models).
- `src/pdf.ts` (lazy browser renderer) and `api/send-paystub.ts` (server checks +
  Resend + log).
- UI:
  - `EmailStubModal` (§908)
  - Build payout Email stub
  - Hourly: email box, New staff email, Email stub, Payment sent (§909)
  - History: pdf / email / Emailed column
  - Admin → Mentor capacity: Pay-stub email column
- Help: new `pay.email` article, plus updates to `pay.build`, `pay.hourly` and
  `pay.history`. Registry 908/909 + UI_INDEX. `.env.example`: `RESEND_API_KEY`,
  `PAYSTUB_FROM`, `PAYSTUB_REPLY_TO`. `pdfmake@0.3.11` added.
- Fix riding along: Hourly staff wiped unsaved timesheet lines when the Rate box
  (or now the email box) saved to the profile. The reset is now keyed on the profile id.

**Verification:** typecheck ✓ · verify **941** (new §30: address rules, email content,
PDF layout, and real pdfmake renders incl. a 40-mentee multi-page stub) ✓ · lint 0
errors / 14 pre-existing ✓ · build ✓ (pdfmake + fonts in lazy chunks; main +38 KB) ·
prettier ✓. Scratchpad-only, not committed:
- The real endpoint against a fetch-level fake of Supabase + Resend: **37/37**.
- A Playwright harness over the real views: **20/20**, including a real PDF rendered
  in Chromium for both stub kinds, and light/dark screenshots.

The first harness run failed on my own stub bug (a spread overwrote the capture key),
not on the app. Visual PDF review surfaced two fixes that were then made: the hero-card
wrap, and ligatures copying "flat" as "fat". The harness is deleted.

**Research facts used** (web search summaries of resend.com, because direct fetches
were blocked by the egress policy; the REST field names were confirmed from the
`resend` npm package source):
- Resend testing domain `resend.dev` only sends to the account's own address.
- REST `POST /emails` takes `reply_to` and `attachments[{filename, content (base64),
  content_type}]`.
- Errors come back as `{statusCode, message, name}`.

## Open questions / next step (awaiting the user)

1. The user does the setup:
   - apply 9962
   - Resend domain + restricted key
   - Vercel `RESEND_API_KEY`, `PAYSTUB_FROM`, `PAYSTUB_REPLY_TO`, then redeploy
   - hourly staff emails
2. Then a **test send to themselves** before real staff.
3. Merge to `main` on their word (chip `v0.11.0`).
4. Not built (by choice): auto-send; a mentor-login portal.
5. Next migration: **9961**.
