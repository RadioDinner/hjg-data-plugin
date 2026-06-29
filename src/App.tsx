import { useState } from "react";
import { useAuth, signOut } from "./auth";
import { useTheme } from "./theme";
import { Login } from "./components/Login";
import { MetricsView } from "./views/MetricsView";
import { DiscoveryView } from "./views/DiscoveryView";
import { MenteesView } from "./views/MenteesView";
import { PayStaffView } from "./views/PayStaffView";
import { RawDataView } from "./views/RawDataView";
import { MarginsView } from "./views/MarginsView";
import { MapsView } from "./views/MapsView";
import { AdminView } from "./views/AdminView";
import { CompanyOptionsView } from "./views/CompanyOptionsView";
import { SectionId } from "./components/SectionId";

type Tab = "metrics" | "discovery" | "mentees" | "paystaff" | "margins" | "raw" | "maps" | "admin" | "options";

const TABS: { key: Tab; label: string; sectionId: string }[] = [
  { key: "metrics", label: "Metrics", sectionId: "metrics.screen" },
  { key: "discovery", label: "Discovery", sectionId: "discovery.screen" },
  { key: "mentees", label: "Mentees", sectionId: "mentees.screen" },
  { key: "paystaff", label: "Pay staff", sectionId: "pay.screen" },
  { key: "margins", label: "Margins", sectionId: "margins.screen" },
  { key: "raw", label: "Raw data", sectionId: "raw.screen" },
  { key: "maps", label: "Maps", sectionId: "maps.screen" },
  { key: "admin", label: "Admin", sectionId: "admin.screen" },
  { key: "options", label: "Company options", sectionId: "options.screen" },
];

export function App() {
  const { user, loading } = useAuth();
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>("metrics");

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
          <span className="topbar__user">{user.email}</span>
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
        {TABS.map((t) => (
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
        {tab === "metrics" && <MetricsView />}
        {tab === "discovery" && <DiscoveryView />}
        {tab === "mentees" && <MenteesView />}
        {tab === "paystaff" && <PayStaffView />}
        {tab === "margins" && <MarginsView />}
        {tab === "raw" && <RawDataView />}
        {tab === "maps" && <MapsView />}
        {tab === "admin" && <AdminView />}
        {tab === "options" && <CompanyOptionsView />}
      </div>

      <footer className="footer">Read-only toward CoachAccountable · data mirrored into Supabase</footer>
    </div>
  );
}
