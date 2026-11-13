import type { AuthorizationClient } from "../../utils/authorization";

export const permissionConcurrencyRepository = {
  async touchUser(tx: AuthorizationClient, userId: string) {
    await tx.user.update({
      where: { id: userId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  },
  async touchRole(tx: AuthorizationClient, roleId: string) {
    // Create a new MVCC row version without changing role data. Role has no
    // updatedAt column; waiting Serializable writers must retry their snapshot.
    await tx.$executeRaw`UPDATE foodprint.roles SET name = name WHERE id = ${roleId}::uuid`;
  },
};
