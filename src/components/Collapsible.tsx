import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { SectionId } from "./SectionId";

// App-wide collapsible-card system. Every screen wraps its content in a
// <CollapseProvider storageKey="<tab>">; each card is a <CollapsibleCard id=…>
// that auto-registers with the nearest provider. The provider persists which
// sections are COLLAPSED to localStorage (per storageKey), so a user's
// expand/collapse choices survive a reload. <CollapseControls/> renders one
// Expand-all / Collapse-all pair per screen (hidden until ≥2 sections exist).
//
// State model: we store the COLLAPSED set (not the open set) so the default —
// nothing stored — means everything open (today's behavior). A card id absent
// from the set is open.

function lsKeyFor(storageKey: string): string {
  return `hjg.collapse.${storageKey}`;
}
function loadCollapsed(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(lsKeyFor(storageKey));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map((v) => String(v))) : new Set();
  } catch {
    return new Set();
  }
}
function saveCollapsed(storageKey: string, collapsed: Set<string>): void {
  try {
    localStorage.setItem(lsKeyFor(storageKey), JSON.stringify([...collapsed]));
  } catch {
    /* private mode / quota — persistence is best-effort */
  }
}

interface CollapseCtx {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  register: (id: string) => void;
  unregister: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  allOpen: boolean;
  allClosed: boolean;
  count: number; // registered (mounted) sections
}

const Ctx = createContext<CollapseCtx | null>(null);

export function CollapseProvider({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  // Which sections are collapsed (persisted). Re-seed when the screen changes.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(storageKey));
  // Which section ids are currently mounted (drives expand/collapse-all + the
  // controls' enabled state). Not persisted — purely the live card set.
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setCollapsed(loadCollapsed(storageKey));
  }, [storageKey]);

  useEffect(() => {
    saveCollapsed(storageKey, collapsed);
  }, [storageKey, collapsed]);

  const toggle = useCallback((id: string) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const register = useCallback((id: string) => {
    setIds((s) => (s.has(id) ? s : new Set(s).add(id)));
  }, []);
  const unregister = useCallback((id: string) => {
    setIds((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);
  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(() => setCollapsed(new Set(ids)), [ids]);
  const isOpen = useCallback((id: string) => !collapsed.has(id), [collapsed]);

  const allOpen = useMemo(() => [...ids].every((id) => !collapsed.has(id)), [ids, collapsed]);
  const allClosed = useMemo(() => ids.size > 0 && [...ids].every((id) => collapsed.has(id)), [ids, collapsed]);

  const value = useMemo<CollapseCtx>(
    () => ({ isOpen, toggle, register, unregister, expandAll, collapseAll, allOpen, allClosed, count: ids.size }),
    [isOpen, toggle, register, unregister, expandAll, collapseAll, allOpen, allClosed, ids.size]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Access the surrounding provider, or null when a card is rendered outside one
// (so CollapsibleCard degrades to always-open instead of throwing).
function useCollapseCtx(): CollapseCtx | null {
  return useContext(Ctx);
}

// The Expand-all / Collapse-all control pair for a screen. Renders nothing until
// at least two collapsible sections are mounted (nothing to "all" below that).
export function CollapseControls() {
  const ctx = useCollapseCtx();
  if (!ctx || ctx.count < 2) return null;
  return (
    <div className="collapse-controls">
      <button type="button" className="btn btn--sm" onClick={ctx.expandAll} disabled={ctx.allOpen}>
        Expand all
      </button>
      <button type="button" className="btn btn--sm" onClick={ctx.collapseAll} disabled={ctx.allClosed}>
        Collapse all
      </button>
    </div>
  );
}

export interface CollapsibleCardProps {
  id: string; // stable collapse key, unique within the screen's provider
  title: ReactNode;
  sectionId?: string; // uiRegistry key for the numbered badge
  help?: ReactNode; // e.g. a <HelpButton/> — rendered in the header, outside the toggle
  actions?: ReactNode; // e.g. header buttons — rendered right, outside the toggle
  variant?: "card" | "inset"; // inset = the .card--inset look (for sub-sections)
  level?: 2 | 3; // heading level
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

// A card whose body collapses under a clickable heading. Uses the WAI-ARIA
// accordion pattern (heading > button[aria-expanded]); the SectionId badge sits
// inside the toggle (it's inert text), while help/actions sit outside it so a
// nested button is never inside the toggle button. Body is unmounted while
// collapsed (charts don't render, effects pause) — the lighter, chart-safe
// choice; transient un-saved input inside a card is lost if you collapse it.
export function CollapsibleCard({
  id,
  title,
  sectionId,
  help,
  actions,
  variant = "card",
  level = 2,
  className,
  style,
  children,
}: CollapsibleCardProps) {
  const ctx = useCollapseCtx();
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  useEffect(() => {
    if (!register || !unregister) return;
    register(id);
    return () => unregister(id);
  }, [id, register, unregister]);

  const open = ctx ? ctx.isOpen(id) : true;
  const Heading = level === 3 ? "h3" : "h2";
  const base = variant === "inset" ? "card card--inset collapsible" : "card collapsible";

  return (
    <div className={`${base}${open ? "" : " collapsible--closed"}${className ? ` ${className}` : ""}`} style={style}>
      <div className="collapsible__head">
        <Heading className="collapsible__title">
          <button
            type="button"
            className="collapsible__toggle"
            aria-expanded={open}
            onClick={() => ctx?.toggle(id)}
            title={open ? "Collapse this section" : "Expand this section"}
          >
            <span className="collapsible__chevron" aria-hidden>
              ▸
            </span>
            <span className="collapsible__label">{title}</span>
            {sectionId ? <SectionId id={sectionId} /> : null}
          </button>
        </Heading>
        {help || actions ? <div className="collapsible__extras">{help}{actions}</div> : null}
      </div>
      {open ? <div className="collapsible__body">{children}</div> : null}
    </div>
  );
}
