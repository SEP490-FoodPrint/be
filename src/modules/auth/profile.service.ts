import type { PrismaClient } from "../../generated/prisma/client";
import type { SessionUser } from "../../types/session-user";
import { getPrisma } from "../../utils/database";
import { authorizationTransaction } from "../../utils/authorization";
import { loadSessionUser } from "../../utils/session-identity";
import type { ProfileUpdateRequestDTO } from "./auth.request.dto";
import type { SessionUserResponseDTO } from "./auth.response.dto";
import { profileRepository } from "./profile.repository";
import { toSessionUserResponseDTO } from "./session.service";

export function createProfileService(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    async update(
      user: SessionUser,
      input: ProfileUpdateRequestDTO,
    ): Promise<SessionUserResponseDTO> {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        const current = await loadSessionUser(user.id, tx);
        const saved = await profileRepository.update(tx, current.id, input);
        return toSessionUserResponseDTO({
          ...current,
          fullName: saved.fullName,
          phone: saved.phone,
        });
      });
    },
  };
}
export const profileService = createProfileService();
export type ProfileService = ReturnType<typeof createProfileService>;
