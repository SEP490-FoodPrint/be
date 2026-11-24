/**
 * `users.email` is nullable only for ATTP officers awaiting email setup
 * (specs/authority-officer-accounts FR-001). Fixtures that always create an
 * email use this to keep `email: string` in their types.
 */
export function withEmail<T extends { email: string | null }>(
  account: T,
): T & { email: string } {
  if (account.email === null) throw new Error("Fixture account has no email");
  return account as T & { email: string };
}
