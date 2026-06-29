// Pure mentor-capacity helpers. A mentor's 1-on-1 capacity utilization should
// count the distinct mentees they meet INDIVIDUALLY — never group attendees.
// Two kinds of group are excluded:
//   1. Named group formats (category "group" → isGroup), handled upstream at
//      sync/categorization time.
//   2. Unnamed multi-client time slots — when a coach has 2+ DISTINCT clients
//      booked at the EXACT same start time, that slot is a group session, not
//      several 1-on-1s. This is the residual "Arthur Nisly"-style inflation the
//      named-format fix didn't cover.
// No I/O, no React — unit-testable in isolation (verify §11).

export interface CapacityAppt {
  coachId: number | null;
  clientId: number | null;
  isGroup: boolean; // named group format (already excluded from capacity)
  slot: string | null; // exact start datetime key; null = unknown (treat as 1-on-1)
}

function slotKey(coachId: number, slot: string): string {
  return `${coachId}|${slot}`;
}

// Identify (coach, slot) keys holding 2+ distinct clients — i.e. group slots.
// Named groups are skipped (already excluded); a client booked twice in one slot
// is NOT a group (distinct-client count stays 1).
export function groupSlotKeys(appts: CapacityAppt[]): Set<string> {
  const clientsBySlot = new Map<string, Set<number>>();
  for (const a of appts) {
    if (a.isGroup) continue;
    if (a.coachId == null || a.clientId == null || !a.slot) continue;
    const key = slotKey(a.coachId, a.slot);
    let set = clientsBySlot.get(key);
    if (!set) {
      set = new Set();
      clientsBySlot.set(key, set);
    }
    set.add(a.clientId);
  }
  const groups = new Set<string>();
  for (const [key, clients] of clientsBySlot) {
    if (clients.size > 1) groups.add(key);
  }
  return groups;
}

// Distinct 1-on-1 mentee client IDs per coach, excluding named groups and any
// appointment that falls in a multi-client slot.
export function oneOnOneMenteesByCoach(appts: CapacityAppt[]): Map<number, Set<number>> {
  const groups = groupSlotKeys(appts);
  const byCoach = new Map<number, Set<number>>();
  for (const a of appts) {
    if (a.isGroup) continue;
    if (a.coachId == null) continue;
    if (a.slot && groups.has(slotKey(a.coachId, a.slot))) continue; // multi-client slot
    let set = byCoach.get(a.coachId);
    if (!set) {
      set = new Set();
      byCoach.set(a.coachId, set);
    }
    if (a.clientId != null) set.add(a.clientId);
  }
  return byCoach;
}
