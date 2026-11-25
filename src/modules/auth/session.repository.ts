import { ROLES } from "../../constants/roles";
import type { AuthorizationClient } from "../../utils/authorization";

/**
 * Login identifier: an email, or the username of a commune food-safety officer that
 * has not set up an email yet (specs/authority-officer-accounts FR-006). Once the
 * officer has an email, the username no longer matches and login fails like a wrong password.
 */
export type LoginMatch =
  | { email: string }
  | {
      username: string;
      email: null;
      roleCode: typeof ROLES.COMMUNE_FOOD_SAFETY_OFFICER;
    };

export const sessionRepository = {
  findByEmail(client: AuthorizationClient, email: string) {
    return client.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
  },
  findPendingOfficer(client: AuthorizationClient, username: string) {
    return client.user.findFirst({
      where: pendingOfficer(username),
      select: { id: true, passwordHash: true },
    });
  },
  async lockPassword(tx: AuthorizationClient, id: string, match: LoginMatch) {
    await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.user.findFirst({
      where: { id, ...match },
      select: { passwordHash: true },
    });
  },
};

export function pendingOfficer(username: string): LoginMatch {
  return {
    username,
    email: null,
    roleCode: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
  };
}
