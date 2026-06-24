import { useState } from "react";
import { useAuth, signOut } from "./auth";
import { useTheme } from "./theme";
import { Login } from "./components/Login";
import { MetricsView } from "./views/MetricsView";
import { DiscoveryView } from "./views/DiscoveryView";
import { JourneysView } from "./views/JourneysView";
import { MenteesView } from "./views/MenteesView";
import { PayStaffView } from "./views/PayStaffView";
import { RawDataView } from "./views/RawDataView";
import { MarginsView } from "./views/MarginsView";
import { MapsView } from "./views/MapsView";
import { AdminView } from "./views/AdminView";
import { CompanyOptionsView } from "./views/CompanyOptionsView";

type Tab = "metrics" | "discovery" | "journeys" | "mentees" | "paystaff" | "margins" | "raw" | "maps" | "admin" | "options";

const TABS: { key: Tab; label: string }[] = [
  { key: "metrics", label: "Metrics" },
  { key: "discovery", label: "Discovery" },
  { key: "journeys", label: "Journeys" },
  { key: "mentees", label: "Mentees" },
  { key: "paystaff", label: "Pay staff" },
  { key: "margins", label: "Margins" },
  { key: "raw", label: "Raw data" },
  { key: "maps", label: "Maps" },
  { key: "admin", label: "Admin" },
  { key: "options", label: "Company options" },
];

export function App() {
  const { user, loading } = useAuth();
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>("metrics");

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Login />;

  return (
    <div className="app">
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
            {t.label}
          </button>
        ))}
      </nav>

      <div className="view">
        {tab === "metrics" && <MetricsView />}
        {tab === "discovery" && <DiscoveryView />}
        {tab === "journeys" && <JourneysView />}
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
