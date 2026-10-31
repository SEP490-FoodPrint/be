import type { Request } from "express";
import type { Prisma } from "../generated/prisma/client";
import type { SessionUser } from "../types/session-user";
import { ROLES } from "../constants/roles";
import {
  databaseOperation,
  identitySelect,
  principalFromIdentity,
  type AuthorizationClient,
} from "./authorization";
import { getPrisma } from "./database";
import { HttpError } from "./http-error";

export const sessionIdentitySelect = {
  ...identitySelect,
  emailVerifiedAt: true,
  email: true,
  phone: true,
  RegistrationRequestAsApplicantUser: {
    select: {
      id: true,
      status: true,
      submittedAt: true,
      rejectionReason: true,
    },
  },
} as const satisfies Prisma.UserSelect;

type Identity = Prisma.UserGetPayload<{ select: typeof sessionIdentitySelect }>;

export function sessionUserFromIdentity(user: Identity | null): SessionUser {
  if (!user) throw new HttpError(401, "Tài khoản không tồn tại");
  const registrationRequest = user.RegistrationRequestAsApplicantUser;
  if (user.status === "ACTIVE") {
    return {
      ...principalFromIdentity(user),
      email: user.email,
      phone: user.phone,
      status: "ACTIVE",
      onboardingRequired: false,
      registrationRequest,
      emailVerifiedAt: user.emailVerifiedAt,
    };
  }
  if (user.status !== "UNVERIFIED")
    throw new HttpError(403, "Tài khoản đã bị khóa hoặc ngừng hoạt động");
  const school =
    user.Role.code === ROLES.SCHOOL_ADMINISTRATION &&
    user.Role.type === "SCHOOL";
  const supplier =
    user.Role.code === ROLES.INGREDIENT_SUPPLIER_ADMIN &&
    user.Role.type === "SUPPLIER";
  if (
    (!school && !supplier) ||
    user.communeFoodSafetyUnitId ||
    (school && user.supplierId) ||
    (supplier && user.schoolId)
  ) {
    throw new HttpError(
      403,
      "Tài khoản không thuộc luồng hoàn thiện hồ sơ hợp lệ",
    );
  }
  // This object deliberately has no permissions and cannot be an AuthPrincipal.
  if (!user.emailVerifiedAt)
    throw new HttpError(
      403,
      "Vui lòng xác minh email trước khi đăng nhập hoặc hoàn thiện hồ sơ",
    );
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    roleId: user.roleId,
    role: user.Role.code,
    orgType: user.Role.type,
    schoolId: user.schoolId,
    supplierId: user.supplierId,
    communeFoodSafetyUnitId: null,
    status: "UNVERIFIED",
    onboardingRequired: true,
    registrationRequest,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

export async function loadSessionUser(
  id: string,
  client?: AuthorizationClient,
): Promise<SessionUser> {
  return databaseOperation(async () => {
    const db = client ?? (await getPrisma());
    return sessionUserFromIdentity(
      await db.user.findUnique({
        where: { id },
        select: sessionIdentitySelect,
      }),
    );
  });
}

export function requireSessionUser(req: Request): SessionUser {
  if (!req.sessionUser)
    throw new HttpError(401, "Chưa xác thực phiên đăng nhập");
  return req.sessionUser;
}
