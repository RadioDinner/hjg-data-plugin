import { useEffect, useMemo, useState } from "react";
import { fetchClients, type ClientOption } from "../db";

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Loads the mentee list once and exposes a client_id -> display-name lookup that
// the entry tables share.
export function useClients(includeExcluded = false) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClients(includeExcluded)
      .then(setClients)
      .catch((e) => setError(String(e)));
  }, [includeExcluded]);

  const nameOf = useMemo(() => {
    const m = new Map(clients.map((c) => [c.id, c.name ?? `#${c.id}`]));
    return (id: number) => m.get(id) ?? `#${id}`;
  }, [clients]);

  return { clients, nameOf, error };
}
