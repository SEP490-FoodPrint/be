import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../generated/prisma/client";
import type { SessionUser } from "../../types/session-user";
import { getPrisma } from "../../utils/database";
import {
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { loadSessionUser } from "../../utils/session-identity";
import { HttpError } from "../../utils/http-error";
import { authSessions, type AuthSessions } from "../../utils/auth-sessions";
import {
  pendingOfficer,
  sessionRepository,
  type LoginMatch,
} from "./session.repository";
import type { LoginRequestDTO } from "./auth.request.dto";
import type { SessionUserResponseDTO } from "./auth.response.dto";

export function toSessionUserResponseDTO(
  user: SessionUser,
): SessionUserResponseDTO {
  const row = user.registrationRequest;
  const common = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    organizationName: user.organizationName ?? null,
    roleId: user.roleId,
    role: user.role,
    orgType: user.orgType,
    schoolId: user.schoolId,
    supplierId: user.supplierId,
    communeFoodSafetyUnitId: user.communeFoodSafetyUnitId,
    registrationRequest: row
      ? {
          id: row.id,
          registrationID: row.code,
          status: row.status,
          submittedAt: row.submittedAt.toISOString(),
          rejectionReason: row.rejectionReason,
        }
      : null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
  if (user.status === "ACTIVE")
    return {
      ...common,
      email: user.email,
      status: "ACTIVE",
      onboardingRequired: false,
      emailSetupRequired: false,
      permissions: [...user.permissions],
    };
  if (user.email === null)
    return {
      ...common,
      email: null,
      status: "UNVERIFIED",
      onboardingRequired: false,
      emailSetupRequired: true,
      registrationRequest: null,
    };
  return {
    ...common,
    email: user.email,
    status: "UNVERIFIED",
    onboardingRequired: true,
    emailSetupRequired: false,
    communeFoodSafetyUnitId: null,
  };
}
const dummyHash =
  "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
export function createSessionService(
  connect: () => Promise<PrismaClient> = getPrisma,
  sessions: AuthSessions = authSessions,
) {
  return {
    async login(input: LoginRequestDTO, previousRefreshToken?: string) {
      return databaseOperation(async () => {
        const db = await connect();
        let match: LoginMatch = { email: input.identifier };
        let candidate = await sessionRepository.findByEmail(
          db,
          input.identifier,
        );
        if (!candidate) {
          match = pendingOfficer(input.identifier);
          candidate = await sessionRepository.findPendingOfficer(
            db,
            input.identifier,
          );
        }
        const valid = await bcrypt.compare(
          input.password,
          candidate?.passwordHash ?? dummyHash,
        );
        if (!candidate || !valid)
          throw new HttpError(401, "Email hoặc mật khẩu không đúng");
        return authorizationTransaction(db, async (tx) => {
          const current = await sessionRepository.lockPassword(
            tx,
            candidate.id,
            match,
          );
          if (current?.passwordHash !== candidate.passwordHash)
            throw new HttpError(401, "Email hoặc mật khẩu không đúng");
          const user = await loadSessionUser(candidate.id, tx);
          if (previousRefreshToken) await sessions.logout(previousRefreshToken);
          return {
            ...(await sessions.issue(user.id)),
            user: toSessionUserResponseDTO(user),
          };
        });
      });
    },
    refresh(refreshToken: string | undefined) {
      return sessions.refresh(refreshToken, async (userId) =>
        toSessionUserResponseDTO(
          await loadSessionUser(userId, await connect()),
        ),
      );
    },
    logout(refreshToken?: string, accessToken?: string) {
      return sessions.logout(refreshToken, accessToken);
    },
    async currentUser(userId: string) {
      return loadSessionUser(userId, await connect());
    },
    getProfile(user: SessionUser) {
      return toSessionUserResponseDTO(user);
    },
  };
}
export const sessionService = createSessionService();
export type SessionService = ReturnType<typeof createSessionService>;
