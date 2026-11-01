import type {
  EmailChallenge,
  EmailVerificationStore,
} from "../../src/utils/email-verification-store";

/** Infrastructure-free service tests only. Production always uses the Redis implementation. */
export function memoryEmailVerification(clock: () => number) {
  const records = new Map<string, EmailChallenge>();
  const cooldowns = new Map<string, { id: string; until: number }>();
  const budgets = new Map<string, { count: number; until: number }>();
  const seconds = () => Math.floor(clock() / 1000);
  const store: EmailVerificationStore = {
    reserve(email, ip, id) {
      const now = seconds();
      const cooldown = cooldowns.get(email);
      if (cooldown && cooldown.until > now)
        return Promise.resolve(cooldown.until - now);
      for (const [key, limit] of [
        ["email:" + email, 5],
        ["ip:" + ip, 20],
      ] as const) {
        const budget = budgets.get(key);
        if (budget && budget.until > now && budget.count >= limit)
          return Promise.resolve(budget.until - now);
      }
      for (const key of ["email:" + email, "ip:" + ip]) {
        const budget = budgets.get(key);
        budgets.set(
          key,
          budget && budget.until > now
            ? { ...budget, count: budget.count + 1 }
            : { count: 1, until: now + 3600 },
        );
      }
      cooldowns.set(email, { id, until: now + 60 });
      return Promise.resolve(0);
    },
    issue(email, record) {
      const reservation = cooldowns.get(email);
      if (
        !reservation ||
        reservation.id !== record.id ||
        reservation.until <= seconds()
      )
        return Promise.resolve(false);
      records.set(email, structuredClone(record));
      return Promise.resolve(true);
    },
    get(email) {
      const record = records.get(email);
      if (!record || record.expiresAt <= seconds()) {
        records.delete(email);
        return Promise.resolve(null);
      }
      return Promise.resolve(structuredClone(record));
    },
    async consume(email, id, hash) {
      const record = await this.get(email);
      if (!record || record.id !== id) return false;
      if (record.codeHash !== hash) {
        record.attempts++;
        if (record.attempts >= 5) records.delete(email);
        else records.set(email, record);
        return false;
      }
      // Keep the check/delete atomic even when two callers entered before the await above.
      if (!records.has(email)) return false;
      records.delete(email);
      return true;
    },
    discard(email, id) {
      if (records.get(email)?.id === id) records.delete(email);
      return Promise.resolve();
    },
  };
  return { store, records };
}
