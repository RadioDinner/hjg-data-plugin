import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  APP_TABS,
  APP_ROLES,
  DEFAULT_ROLE_TABS,
  resolveAllowedTabs,
  fetchAppUsers,
  saveAppUser,
  deleteAppUser,
  fetchCoachNames,
  type AppRole,
  type AppUserRecord,
} from "../db";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";

// User permissions (§405, Admin) — the "bones" of per-user access. One row per
// person (matched to their sign-in by EMAIL); each row picks a role and,
// optionally, an explicit set of visible tabs. Resolution rules live in
// lib/permissions.ts: no row = ALL tabs (today's behavior), admins always all,
// a mentor row can be linked to a ca_coaches id for the future mentor login.
export function UserPermissionsCard() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AppUserRecord[]>([]);
  const [coachNames, setCoachNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Add-user form.
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("staff");

  async function load() {
    try {
      const [u, c] = await Promise.all([fetchAppUsers(), fetchCoachNames().catch(() => new Map<number, string>())]);
      setUsers(u);
      setCoachNames(c);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coachOptions = useMemo(
    () => [...coachNames.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [coachNames]
  );

  async function persist(rec: AppUserRecord) {
    setBusy(true);
    setFlash(null);
    try {
      await saveAppUser(user?.id ?? "", rec);
      setUsers((prev) => prev.map((u) => (u.id === rec.id ? rec : u)));
      setError(null);
    } catch (e) {
      setError(String(e));
      await load(); // re-sync on failure so the grid shows what's actually stored
    } finally {
      setBusy(false);
    }
  }

  async function addUser() {
    const email = newEmail.trim();
    if (!email || !email.includes("@")) {
      setError("Enter the person's sign-in email address.");
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      await saveAppUser(user?.id ?? "", {
        email,
        displayName: newName.trim() || null,
        role: newRole,
        allowedTabs: null,
        coachId: null,
        isActive: true,
      });
      setNewEmail("");
      setNewName("");
      setNewRole("staff");
      setFlash(`${email} added.`);
      setError(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rec: AppUserRecord) {
    if (!confirm(`Remove ${rec.email}? They fall back to FULL access (no row = all tabs, while the system is bones).`)) return;
    setBusy(true);
    try {
      await deleteAppUser(rec.id);
      setUsers((prev) => prev.filter((u) => u.id !== rec.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Toggle one tab for a user. A row whose allowed_tabs is NULL (role default)
  // materializes the default list first, so the first click behaves as expected.
  function toggleTab(rec: AppUserRecord, tabKey: string, on: boolean) {
    const base = rec.allowedTabs ?? [...DEFAULT_ROLE_TABS[rec.role]];
    const next = on ? [...new Set([...base, tabKey])] : base.filter((k) => k !== tabKey);
    persist({ ...rec, allowedTabs: next });
  }

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            User permissions <SectionId id="admin.users" />
            <HelpButton id="admin.users" label="User permissions" />
          </h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Who can see which tabs. People are matched to a row by their <strong>sign-in email</strong>; someone{" "}
            <strong>without a row keeps full access</strong> while this system is bones, and <strong>admins always see
            everything</strong>. Assign a mentor's row to their coach record to prepare for mentor logins. Needs migration{" "}
            <code>9968_app_users.sql</code>.
          </div>
        </div>
      </div>

      {error && <div className="notice notice--warn">{error}</div>}
      {flash && <div className="notice notice--info">{flash}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ textAlign: "left" }}>Name</th>
                  <th>Role</th>
                  <th>Active</th>
                  <th style={{ textAlign: "left" }}>Mentor link</th>
                  <th style={{ textAlign: "left" }}>Tabs</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const effective = resolveAllowedTabs(u);
                  const usingDefault = u.allowedTabs == null;
                  return (
                    <tr key={u.id}>
                      <td style={{ textAlign: "left" }}>{u.email}</td>
                      <td style={{ textAlign: "left" }}>
                        <input
                          className="input--inline"
                          type="text"
                          defaultValue={u.displayName ?? ""}
                          placeholder="—"
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== u.displayName) persist({ ...u, displayName: v });
                          }}
                          aria-label={`Display name for ${u.email}`}
                        />
                      </td>
                      <td>
                        <select
                          value={u.role}
                          disabled={busy}
                          onChange={(e) => persist({ ...u, role: e.target.value as AppRole })}
                          aria-label={`Role for ${u.email}`}
                        >
                          {APP_ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={u.isActive}
                          disabled={busy}
                          onChange={(e) => persist({ ...u, isActive: e.target.checked })}
                          aria-label={`${u.email} active`}
                        />
                      </td>
                      <td style={{ textAlign: "left" }}>
                        <select
                          value={u.coachId ?? ""}
                          disabled={busy}
                          onChange={(e) => persist({ ...u, coachId: e.target.value ? Number(e.target.value) : null })}
                          aria-label={`Coach link for ${u.email}`}
                          title="Link this login to a CoachAccountable coach (for the future mentor experience)"
                        >
                          <option value="">—</option>
                          {coachOptions.map(([id, name]) => (
                            <option key={id} value={id}>{name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {u.role === "admin" ? (
                          <span className="muted" style={{ fontSize: 12 }}>all tabs (admin)</span>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                            {APP_TABS.map((t) => (
                              <label key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, whiteSpace: "nowrap" }}>
                                <input
                                  type="checkbox"
                                  checked={effective.has(t.key)}
                                  disabled={busy || !u.isActive}
                                  onChange={(e) => toggleTab(u, t.key, e.target.checked)}
                                />
                                {t.label}
                              </label>
                            ))}
                            {usingDefault ? (
                              <span className="pill" title="No explicit list saved — showing the role's default">role default</span>
                            ) : (
                              <button
                                className="linkbtn"
                                style={{ fontSize: 12 }}
                                disabled={busy}
                                onClick={() => persist({ ...u, allowedTabs: null })}
                                title="Drop the explicit list and use the role's default tabs"
                              >
                                reset to role default
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="num">
                        <button className="btn btn--sm btn--danger" disabled={busy} onClick={() => remove(u)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No users set up yet — everyone signed in has full access. Add people below to start scoping tabs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="entry" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="field">
              <span>Sign-in email</span>
              <input type="email" value={newEmail} placeholder="person@example.com" onChange={(e) => setNewEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Name</span>
              <input type="text" value={newName} placeholder="optional" onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as AppRole)}>
                {APP_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <button className="btn btn--primary" onClick={addUser} disabled={busy}>
              Add user
            </button>
          </div>
        </>
      )}
    </div>
  );
}
