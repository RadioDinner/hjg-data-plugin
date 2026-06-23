import { useEffect, useMemo, useRef, useState } from "react";
import { COMPANY_OPTIONS, companyOptionDefault, type CompanyOption } from "../companyOptions";
import {
  fetchCompanyOptions,
  setCompanyOption,
  parseStageColorConfig,
  serializeStageColorConfig,
  resolveStageColors,
  STAGE_KEYS,
  STAGE_LABELS,
  type StageColorConfig,
} from "../db";
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
                    {o.type === "stageColors" ? (
                      <StageColorsControl value={valueOf(o)} onSave={(v) => change(o, v)} />
                    ) : (
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
                    )}
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

// The Journeys per-stage color editor (Company option `journeys_stage_colors`).
// "Gradient" blends two endpoint colors across the six stages; "Custom" sets each
// stage individually. Edits preview live; saves are debounced so dragging a color
// picker doesn't spam the DB. The config is stored as a JSON string.
function StageColorsControl({ value, onSave }: { value: string; onSave: (serialized: string) => void }) {
  const [cfg, setCfg] = useState<StageColorConfig>(() => parseStageColorConfig(value));
  const lastSavedRef = useRef<string>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed from the stored value on load / external change, but ignore the echo
  // of our own saves so editing isn't clobbered.
  useEffect(() => {
    if (value !== lastSavedRef.current) {
      lastSavedRef.current = value;
      setCfg(parseStageColorConfig(value));
    }
  }, [value]);

  function update(next: StageColorConfig) {
    setCfg(next);
    const serialized = serializeStageColorConfig(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSavedRef.current = serialized;
      onSave(serialized);
    }, 400);
  }

  const resolved = resolveStageColors(cfg);

  return (
    <div className="stage-colors">
      <div className="seg" role="tablist" aria-label="Stage color mode">
        <button
          type="button"
          className={`seg__btn ${cfg.mode === "gradient" ? "seg__btn--active" : ""}`}
          onClick={() => update({ ...cfg, mode: "gradient" })}
        >
          Gradient
        </button>
        <button
          type="button"
          className={`seg__btn ${cfg.mode === "custom" ? "seg__btn--active" : ""}`}
          onClick={() => update({ ...cfg, mode: "custom" })}
        >
          Custom
        </button>
      </div>

      {cfg.mode === "gradient" ? (
        <div className="stage-colors__inputs">
          <label className="stage-colors__field">
            <span>From</span>
            <input type="color" value={cfg.from} onChange={(e) => update({ ...cfg, from: e.target.value })} />
          </label>
          <span className="muted" aria-hidden>
            →
          </span>
          <label className="stage-colors__field">
            <span>To</span>
            <input type="color" value={cfg.to} onChange={(e) => update({ ...cfg, to: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="stage-colors__inputs stage-colors__inputs--custom">
          {STAGE_KEYS.map((k, i) => (
            <label key={k} className="stage-colors__field">
              <span>{STAGE_LABELS[k]}</span>
              <input
                type="color"
                value={resolved[i]}
                onChange={(e) => {
                  const colors = [...resolved];
                  colors[i] = e.target.value;
                  update({ ...cfg, colors });
                }}
              />
            </label>
          ))}
        </div>
      )}

      {/* Live preview of the six resolved stage colors, in order. */}
      <div className="stage-colors__preview">
        {STAGE_KEYS.map((k, i) => (
          <div key={k} className="stage-colors__swatch" title={`${STAGE_LABELS[k]} — ${resolved[i]}`}>
            <span className="stage-colors__chip" style={{ background: resolved[i] }} />
            <span className="stage-colors__caption muted">{STAGE_LABELS[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
