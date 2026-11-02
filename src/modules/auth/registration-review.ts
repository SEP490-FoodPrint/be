import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { HttpError } from "../../utils/http-error";
import { registrationApplicantSelect } from "../registration/registration.select";

export const reviewSelect = {
  id: true,
  applicantUserId: true,
  requestType: true,
  status: true,
  profileData: true,
  supportingDocuments: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  updatedAt: true,
  reviewedByUserId: true,
  applicantUser: { select: registrationApplicantSelect },
  reviewedByUser: { select: { id: true, fullName: true } },
} as const satisfies Prisma.RegistrationRequestSelect;

export type ReviewRow = Prisma.RegistrationRequestGetPayload<{
  select: typeof reviewSelect;
}>;

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    // Code-unit order is deterministic across server locales; never use
    // locale-dependent comparison for a version used in optimistic locking.
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function reviewVersion(row: ReviewRow): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(row)))
    .digest("hex");
}

export function expectedReviewVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new HttpError(400, "Phiên bản hồ sơ không hợp lệ");
  return value;
}
