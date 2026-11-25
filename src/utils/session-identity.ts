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
  School: { select: { name: true } },
  Supplier: { select: { name: true } },
  communeFoodSafetyUnit: { select: { name: true } },
  RegistrationRequestAsApplicantUser: {
    select: {
      id: true,
      code: true,
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
  const organizationName =
    user.School?.name ??
    user.Supplier?.name ??
    user.communeFoodSafetyUnit?.name ??
    null;
  if (user.status === "ACTIVE") {
    // chk_users_email_required: an ACTIVE account always has an email.
    if (!user.email) throw new HttpError(403, "Tài khoản chưa có email hợp lệ");
    return {
      ...principalFromIdentity(user),
      email: user.email,
      phone: user.phone,
      organizationName,
      status: "ACTIVE",
      onboardingRequired: false,
      registrationRequest,
      emailVerifiedAt: user.emailVerifiedAt,
    };
  }
  if (user.status !== "UNVERIFIED")
    throw new HttpError(403, "Tài khoản đã bị khóa hoặc ngừng hoạt động");
  if (
    user.Role.code === ROLES.COMMUNE_FOOD_SAFETY_OFFICER &&
    user.Role.type === "AUTHORITY" &&
    user.email === null &&
    !user.emailVerifiedAt &&
    user.communeFoodSafetyUnitId &&
    !user.schoolId &&
    !user.supplierId
  ) {
    // Officer created by System Admin: may only set up an email (FR-004); no permissions.
    return {
      id: user.id,
      username: user.username,
      email: null,
      phone: user.phone,
      organizationName,
      fullName: user.fullName,
      roleId: user.roleId,
      role: user.Role.code,
      orgType: user.Role.type,
      schoolId: null,
      supplierId: null,
      communeFoodSafetyUnitId: user.communeFoodSafetyUnitId,
      status: "UNVERIFIED",
      onboardingRequired: false,
      registrationRequest: null,
      emailVerifiedAt: null,
    };
  }
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
  if (!user.email) throw new HttpError(403, "Tài khoản chưa có email hợp lệ");
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    organizationName,
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

/** Cán bộ ATTP chưa cập nhật email (FR-004): chỉ được dùng luồng cập nhật email. */
export function requiresEmailSetup(
  user: SessionUser,
): user is Extract<SessionUser, { email: null }> {
  return user.email === null;
}

export const emailSetupFirst = () =>
  new HttpError(
    403,
    "Vui lòng cập nhật email trước khi sử dụng chức năng này",
    "EMAIL_SETUP_REQUIRED",
  );

export function requireSessionUser(req: Request): SessionUser {
  if (!req.sessionUser)
    throw new HttpError(401, "Chưa xác thực phiên đăng nhập");
  return req.sessionUser;
}
