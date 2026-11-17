import type { AuthorizationClient } from "../../utils/authorization";
export const sessionRepository = {
  findByEmail(client: AuthorizationClient, email: string) {
    return client.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
  },
  async lockPassword(tx: AuthorizationClient, id: string, email: string) {
    await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.user.findFirst({
      where: { id, email },
      select: { passwordHash: true },
    });
  },
};
