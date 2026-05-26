import { useState } from "react";
import { useAuth, signOut } from "./auth";
import { Login } from "./components/Login";
import { ReportsView } from "./views/ReportsView";
import { GraduationsView } from "./views/GraduationsView";
import { DiscoveryView } from "./views/DiscoveryView";
import { CadenceView } from "./views/CadenceView";
import { AdminView } from "./views/AdminView";

type Tab = "reports" | "graduations" | "discovery" | "cadence" | "admin";

const TABS: { key: Tab; label: string }[] = [
  { key: "reports", label: "Reports" },
  { key: "graduations", label: "Graduations" },
  { key: "discovery", label: "Discovery" },
  { key: "cadence", label: "Cadence" },
  { key: "admin", label: "Admin" },
];

export function App() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("reports");

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Login />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <h1>Data Hub</h1>
          <span className="topbar__subtitle">Mentoring metrics &amp; records</span>
        </div>
        <div className="topbar__controls">
          <span className="topbar__user">{user.email}</span>
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
        {tab === "reports" && <ReportsView />}
        {tab === "graduations" && <GraduationsView />}
        {tab === "discovery" && <DiscoveryView />}
        {tab === "cadence" && <CadenceView />}
        {tab === "admin" && <AdminView />}
      </div>

      <footer className="footer">Read-only toward CoachAccountable · data mirrored into Supabase</footer>
    </div>
  );
}
