// Thin store abstraction over Vercel KV. When KV env vars are absent (local dev),
// it falls back to in-memory maps. The fallback does NOT persist across
// serverless invocations, so the hard budget guarantee only holds with KV
// attached in production — health/budget endpoints report whether KV is active.

const hasKV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

type KVClient = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

let kvPromise: Promise<KVClient> | null = null;
async function kvClient(): Promise<KVClient> {
  if (!kvPromise) {
    kvPromise = import("@vercel/kv").then((m) => m.kv as unknown as KVClient);
  }
  return kvPromise;
}

// --- in-memory fallback ---
const memValues = new Map<string, { value: unknown; expiresAt: number | null }>();

function memGet<T>(key: string): T | null {
  const entry = memValues.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
    memValues.delete(key);
    return null;
  }
  return entry.value as T;
}

export const store = {
  kvActive: hasKV,

  async getJSON<T>(key: string): Promise<T | null> {
    if (hasKV) return (await kvClient()).get<T>(key);
    return memGet<T>(key);
  },

  async setJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (hasKV) {
      const kv = await kvClient();
      await kv.set(key, value, ttlSeconds ? { ex: ttlSeconds } : undefined);
      return;
    }
    memValues.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  },

  // Atomic increment; returns the new value. Used by the budget counter so
  // concurrent invocations cannot race past the cap.
  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (hasKV) {
      const kv = await kvClient();
      const next = await kv.incr(key);
      if (next === 1 && ttlSeconds) await kv.expire(key, ttlSeconds);
      return next;
    }
    const current = memGet<number>(key) ?? 0;
    const next = current + 1;
    memValues.set(key, {
      value: next,
      expiresAt: ttlSeconds && current === 0 ? Date.now() + ttlSeconds * 1000 : memValues.get(key)?.expiresAt ?? null,
    });
    return next;
  },

  async getNumber(key: string): Promise<number> {
    const v = await this.getJSON<number>(key);
    return typeof v === "number" ? v : 0;
  },
};
