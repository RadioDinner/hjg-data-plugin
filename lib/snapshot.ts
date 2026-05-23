// Snapshot-first / refresh-within-cap orchestration. Serves a stored snapshot
// when fresh; refreshes from CA only when stale AND budget remains; serves the
// last-good snapshot (marked stale) when the budget is exhausted.

import { store } from "./store";
import { BudgetExhaustedError } from "./budget";

interface Envelope<T> {
  data: T;
  computedAt: number; // epoch ms
}

export interface SnapshotResult<T> {
  data: T;
  stale: boolean;
  ageSeconds: number;
}

export async function getOrRefresh<T>(
  key: string,
  ttlSeconds: number,
  refresh: () => Promise<T>
): Promise<SnapshotResult<T>> {
  const existing = await store.getJSON<Envelope<T>>(key);
  const now = Date.now();
  const ageSeconds = existing ? Math.floor((now - existing.computedAt) / 1000) : Infinity;

  if (existing && ageSeconds < ttlSeconds) {
    return { data: existing.data, stale: false, ageSeconds };
  }

  try {
    const data = await refresh();
    const envelope: Envelope<T> = { data, computedAt: Date.now() };
    await store.setJSON(key, envelope, ttlSeconds * 24);
    return { data, stale: false, ageSeconds: 0 };
  } catch (e) {
    // Out of budget (or CA unreachable): serve the last-good snapshot if we have
    // one, rather than failing. Only rethrow when there is nothing to fall back to.
    if (existing && e instanceof BudgetExhaustedError) {
      return { data: existing.data, stale: true, ageSeconds };
    }
    throw e;
  }
}
