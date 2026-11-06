import type { Prisma } from "../../generated/prisma/client";

/** Public account fields allowed in registration list/detail responses. */
export const registrationApplicantSelect = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
} as const satisfies Prisma.UserSelect;

export const registrationListSelect = {
  registrationNumber: true,
  id: true,
  applicantUserId: true,
  applicantUser: { select: registrationApplicantSelect },
  requestType: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  updatedAt: true,
} as const satisfies Prisma.RegistrationRequestSelect;
