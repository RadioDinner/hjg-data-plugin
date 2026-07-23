import { useEffect, useMemo, useState } from "react";
import { useAuth, signOut } from "./auth";
import { useTheme } from "./theme";
import { Login } from "./components/Login";
import { MetricsView } from "./views/MetricsView";
import { DiscoveryView } from "./views/DiscoveryView";
import { MenteesView } from "./views/MenteesView";
import { UpdateMenteeView } from "./views/UpdateMenteeView";
import { PayStaffView } from "./views/PayStaffView";
import { TimeClockView } from "./views/TimeClockView";
import { FinancialEventView } from "./views/FinancialEventView";
import { RawDataView } from "./views/RawDataView";
import { MarginsView } from "./views/MarginsView";
import { MapsView } from "./views/MapsView";
import { AdminView } from "./views/AdminView";
import { CompanyOptionsView } from "./views/CompanyOptionsView";
import { SectionId } from "./components/SectionId";
import { VersionBadge } from "./components/VersionBadge";
import { NotificationsBell } from "./components/NotificationsBell";
import { CollapseProvider, CollapseControls } from "./components/Collapsible";
import { APP_TABS, resolveAllowedTabs, fetchMyAppUser } from "./db";

// The tab list lives in lib/permissions.ts (APP_TABS) — the same list the
// User-permissions card (§405) offers as checkboxes, so the nav and the
// permission grid can never drift apart.

export function App() {
  const { user, loading } = useAuth();
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<string>("metrics");
  // Tabs the signed-in user may see. null = still resolving — show everything
  // (the no-row default) until the app_users lookup lands, then snap.
  const [allowed, setAllowed] = useState<Set<string> | null>(null);
  // Bumped after actions that create a notification (e.g. a financial-event
  // report) so the bell refreshes immediately instead of on the next poll.
  const [bellRefresh, setBellRefresh] = useState(0);

  useEffect(() => {
    if (!user) {
      setAllowed(null);
      return;
    }
    let live = true;
    fetchMyAppUser(user.email)
      .then((rec) => live && setAllowed(resolveAllowedTabs(rec)))
      .catch(() => live && setAllowed(resolveAllowedTabs(null)));
    return () => {
      live = false;
    };
  }, [user]);

  const tabs = useMemo(() => APP_TABS.filter((t) => !allowed || allowed.has(t.key)), [allowed]);

  // If the active tab just got filtered away, land on the first visible one.
  useEffect(() => {
    if (allowed && !allowed.has(tab) && tabs.length) setTab(tabs[0].key);
  }, [allowed, tab, tabs]);

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Login />;

  return (
    <div className={tab === "mentees" ? "app app--wide" : "app"}>
      <header className="topbar">
        <div className="topbar__title">
          <h1>Data Hub</h1>
          <span className="topbar__subtitle">Discovery &amp; conversion metrics</span>
        </div>
        <div className="topbar__controls">
          <VersionBadge />
          <span className="topbar__user">{user.email}</span>
          <NotificationsBell refreshKey={bellRefresh} onNavigate={(k) => setTab(k)} />
          <button
            className="theme-toggle"
            onClick={toggle}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button className="btn" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <SectionId id={t.sectionId} />
          </button>
        ))}
      </nav>

      <div className="view">
        {tabs.length === 0 ? (
          <div className="card">
            <h2>No tabs assigned</h2>
            <p className="muted">
              Your account ({user.email}) has no tabs assigned yet. Ask an admin to grant access under{" "}
              <strong>Admin → User permissions</strong>.
            </p>
          </div>
        ) : (
          // One collapse scope per tab: cards register with this provider and
          // their expand/collapse state persists to localStorage under the tab
          // key. `key={tab}` gives each screen a fresh provider (its own saved
          // state) as the user switches tabs.
          <CollapseProvider key={tab} storageKey={tab}>
            <CollapseControls />
            {tab === "metrics" && <MetricsView />}
            {tab === "discovery" && <DiscoveryView />}
            {tab === "mentees" && <MenteesView />}
            {tab === "update" && <UpdateMenteeView />}
            {tab === "paystaff" && <PayStaffView />}
            {tab === "timeclock" && <TimeClockView />}
            {tab === "finevent" && <FinancialEventView onSubmitted={() => setBellRefresh((k) => k + 1)} />}
            {tab === "margins" && <MarginsView />}
            {tab === "raw" && <RawDataView />}
            {tab === "maps" && <MapsView />}
            {tab === "admin" && <AdminView />}
            {tab === "options" && <CompanyOptionsView />}
          </CollapseProvider>
        )}
      </div>

      <footer className="footer">Read-only toward CoachAccountable · data mirrored into Supabase</footer>
    </div>
  );
}
