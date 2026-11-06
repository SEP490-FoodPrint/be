import { createHash } from "node:crypto";
import { HttpError } from "../../utils/http-error";
import type { ReviewRow } from "./onboarding.repository";
export type { ReviewRow } from "./onboarding.repository";

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
    .update(
      JSON.stringify(
        canonical({
          id: row.id,
          applicantUserId: row.applicantUserId,
          requestType: row.requestType,
          status: row.status,
          profileData: row.profileData,
          supportingDocuments: row.supportingDocuments,
          submittedAt: row.submittedAt,
          reviewedAt: row.reviewedAt,
          rejectionReason: row.rejectionReason,
          updatedAt: row.updatedAt,
          reviewedByUserId: row.reviewedByUserId,
          applicantUser: row.applicantUser,
          reviewedByUser: row.reviewedByUser,
        }),
      ),
    )
    .digest("hex");
}

export function expectedReviewVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new HttpError(400, "Phiên bản hồ sơ không hợp lệ");
  return value;
}
