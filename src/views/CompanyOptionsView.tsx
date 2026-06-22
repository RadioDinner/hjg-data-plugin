import { useEffect, useMemo, useState } from "react";
import { COMPANY_OPTIONS, companyOptionDefault, type CompanyOption } from "../companyOptions";
import { fetchCompanyOptions, setCompanyOption } from "../db";
import { HelpButton } from "../components/HelpDrawer";

// Self-serve, organization-wide dashboard settings. Every option is declared in
// src/companyOptions.ts (the registry); this tab just renders them grouped by
// section as dropdowns and persists each change to app_settings immediately.
export function CompanyOptionsView() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCompanyOptions()
      .then((v) => {
        if (!cancelled) setValues(v);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sections = useMemo(() => {
    const m = new Map<string, CompanyOption[]>();
    for (const o of COMPANY_OPTIONS) {
      const arr = m.get(o.section) ?? [];
      arr.push(o);
      m.set(o.section, arr);
    }
    return [...m.entries()];
  }, []);

  const valueOf = (o: CompanyOption) => values[o.key] ?? companyOptionDefault(o.key);

  async function change(o: CompanyOption, value: string) {
    const prev = valueOf(o);
    setValues((v) => ({ ...v, [o.key]: value }));
    setSavingKey(o.key);
    setSavedKey(null);
    setError(null);
    try {
      await setCompanyOption(o.key, value);
      setSavedKey(o.key);
      window.setTimeout(() => setSavedKey((k) => (k === o.key ? null : k)), 2000);
    } catch (e) {
      setValues((v) => ({ ...v, [o.key]: prev })); // revert on failure
      setError(String(e));
    } finally {
      setSavingKey((k) => (k === o.key ? null : k));
    }
  }

  return (
    <section className="card">
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Company options <HelpButton id="company.options" label="Company options" />
      </h2>
      <p className="view__hint">
        Dashboard settings you can change yourself — no code change needed. These are{" "}
        <strong>organization-wide</strong>: a change here applies for everyone. Each setting saves
        as soon as you pick it.
      </p>
      {error && <div className="notice notice--warn">{error}</div>}
      {loading ? (
        <div className="loading">Loading…</div>
      ) : sections.length === 0 ? (
        <p className="muted">No options defined yet.</p>
      ) : (
        sections.map(([section, opts]) => (
          <div key={section} className="card card--inset" style={{ marginTop: 16 }}>
            <h3>{section}</h3>
            <div className="options-grid">
              {opts.map((o) => (
                <div key={o.key} className="option-row">
                  <div className="option-row__label">
                    <label htmlFor={`opt-${o.key}`}>{o.label}</label>
                    <p className="muted">{o.help}</p>
                  </div>
                  <div className="option-row__control">
                    <select
                      id={`opt-${o.key}`}
                      value={valueOf(o)}
                      onChange={(e) => change(o, e.target.value)}
                      disabled={savingKey === o.key}
                    >
                      {o.choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <span className="option-row__status muted">
                      {savingKey === o.key ? "Saving…" : savedKey === o.key ? "Saved ✓" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
