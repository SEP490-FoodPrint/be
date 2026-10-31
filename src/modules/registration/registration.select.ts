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
