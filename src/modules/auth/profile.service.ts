import type { PrismaClient } from "../../generated/prisma/client";
import type { SessionUser } from "../../types/session-user";
import { getPrisma } from "../../utils/database";
import { authorizationTransaction } from "../../utils/authorization";
import { loadSessionUser } from "../../utils/session-identity";
import type { PersonalProfileUpdate } from "./profile.validation";

export function createProfileService(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    async update(
      user: SessionUser,
      input: PersonalProfileUpdate,
    ): Promise<SessionUser> {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        const current = await loadSessionUser(user.id, tx);
        const saved = await tx.user.update({
          where: { id: current.id },
          data: {
            ...(input.fullName === undefined
              ? {}
              : { fullName: input.fullName }),
            ...(input.phone === undefined ? {} : { phone: input.phone }),
          },
          select: { fullName: true, phone: true },
        });
        return { ...current, ...saved };
      });
    },
  };
}
export const profileService = createProfileService();
export type ProfileService = ReturnType<typeof createProfileService>;
