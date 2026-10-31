import type {
  AuthSessionStore,
  StoredSession,
} from "../../src/utils/auth-session-store";

/** Test-only storage. Runtime always uses Redis and never falls back to this map. */
export function memorySessions(clock: () => number = Date.now) {
  const records = new Map<string, StoredSession>();
  const store: AuthSessionStore = {
    create(id, record) {
      if (records.has(id)) return Promise.resolve(false);
      records.set(id, structuredClone(record));
      return Promise.resolve(true);
    },
    get(id) {
      const record = records.get(id);
      if (!record || record.expiresAt <= Math.floor(clock() / 1000)) {
        records.delete(id);
        return Promise.resolve(null);
      }
      return Promise.resolve(structuredClone(record));
    },
    rotate(id, previousHash, nextHash) {
      const record = records.get(id);
      if (!record) return Promise.resolve(false);
      if (record.tokenHash !== previousHash) {
        records.delete(id);
        return Promise.resolve(false);
      }
      records.set(id, { ...record, tokenHash: nextHash });
      return Promise.resolve(true);
    },
    revoke(id, expectedHash) {
      if (
        expectedHash === undefined ||
        records.get(id)?.tokenHash === expectedHash
      )
        records.delete(id);
      return Promise.resolve();
    },
  };
  return { store, records };
}
