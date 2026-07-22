-- Company option: "Transition to..." choices for the Update Mentee tab's
-- Transition form (§552), 2026-07-22. Seeds the `mentee_transition_options` key
-- with the user's list. Staff can UPDATE app_settings (RLS) but cannot INSERT,
-- so the key must be seeded here. The value is a JSON STRING (array of names,
-- stored via to_jsonb(...::text)) so it rides the string-valued Company-options
-- plumbing. See lib/transitionOptions.ts. Re-runnable: on conflict do nothing
-- preserves any list already edited in the app.

insert into app_settings (key, value) values
  ('mentee_transition_options',
   to_jsonb('["Jumpstart Your Freedom","4x Mentoring","2x Mentoring","1x Mentoring","Graduated","Quit","Fired"]'::text))
on conflict (key) do nothing;
