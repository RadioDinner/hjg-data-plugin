import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { fetchNotifications, markNotificationsRead, type AppNotification } from "../db";
import { fmtDateTime } from "../format";
import { SectionId } from "./SectionId";

// Topbar notifications bell (§907): the in-app alert channel — e.g. a submitted
// "Report financial event" form notifies org support staff here. Polls the feed
// every 60s; unread = notifications this user hasn't dismissed. Fails quiet
// when migration 9965 isn't applied (the feed is just empty).
export function NotificationsBell({
  refreshKey = 0,
  onNavigate,
}: {
  refreshKey?: number; // bump to force an immediate refresh (e.g. after submitting a report)
  onNavigate?: (tabKey: string) => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    setItems(await fetchNotifications());
  }
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const unread = useMemo(
    () => items.filter((n) => !user?.id || !n.readBy.includes(user.id)),
    [items, user]
  );

  async function markAllRead() {
    if (!user?.id || unread.length === 0) return;
    try {
      await markNotificationsRead(user.id, unread);
      setItems((prev) => prev.map((n) => (n.readBy.includes(user.id) ? n : { ...n, readBy: [...n.readBy, user.id] })));
    } catch {
      // best-effort; the next poll re-syncs
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className="btn"
        onClick={() => setOpen((o) => !o)}
        title={unread.length ? `${unread.length} unread notification${unread.length === 1 ? "" : "s"}` : "Notifications"}
        aria-label="Notifications"
        style={{ position: "relative" }}
      >
        🔔
        {unread.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "var(--danger, #dc2626)",
              color: "#fff",
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              lineHeight: "16px",
              padding: "0 3px",
              textAlign: "center",
            }}
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 360,
            maxHeight: 420,
            overflow: "auto",
            zIndex: 60,
            boxShadow: "0 12px 40px rgba(15, 23, 42, 0.25)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 13 }}>
              Notifications <SectionId id="drawer.notifications" />
            </strong>
            <button className="btn btn--sm" onClick={markAllRead} disabled={unread.length === 0}>
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Nothing yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {items.slice(0, 20).map((n) => {
                const isUnread = !user?.id || !n.readBy.includes(user.id);
                return (
                  <button
                    key={n.id}
                    className="card card--inset"
                    style={{
                      textAlign: "left",
                      cursor: n.linkTab && onNavigate ? "pointer" : "default",
                      opacity: isUnread ? 1 : 0.6,
                      border: isUnread ? "1px solid var(--accent)" : undefined,
                      padding: 10,
                    }}
                    onClick={() => {
                      if (n.linkTab && onNavigate) {
                        onNavigate(n.linkTab);
                        setOpen(false);
                      }
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: isUnread ? 700 : 500 }}>{n.title}</div>
                    {n.body && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{n.body}</div>}
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{fmtDateTime(n.createdAt)}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
