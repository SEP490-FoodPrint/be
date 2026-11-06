import type { AuthorizationClient } from "../../utils/authorization";
export const sessionRepository = {
  findCandidates(client: AuthorizationClient, identifier: string) {
    return client.user.findMany({
      where: { OR: [{ username: identifier }, { email: identifier }] },
      take: 2,
      select: { id: true, passwordHash: true },
    });
  },
  async lockPassword(tx: AuthorizationClient, id: string) {
    await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.user.findUnique({
      where: { id },
      select: { passwordHash: true },
    });
  },
};
