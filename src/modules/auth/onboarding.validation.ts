import { z } from "zod";
import {
  parseRequest,
  requiredText,
  requestUuidSchema,
} from "../../utils/request-validation";
import { MAX_PROFILE_DOCUMENTS } from "../../utils/onboarding-documents";

export const MAX_CERTIFICATIONS = 20;
const optionalText = (maximum: number) =>
  z
    .union([requiredText(maximum), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value));
const calendarDate = optionalText(10).refine(
  (value) => {
    if (value === null) return true;
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000"))
      return false;
    const date = new Date(value + "T00:00:00.000Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  },
  { error: "Ngày phải là ngày lịch hợp lệ theo YYYY-MM-DD" },
);

export const certificationSchema = z
  .strictObject({
    certificationType: requiredText(120),
    certificateNo: requiredText(120),
    issuedDate: calendarDate,
    expiryDate: calendarDate,
  })
  .refine(
    (value) =>
      !value.issuedDate ||
      !value.expiryDate ||
      value.expiryDate >= value.issuedDate,
    { path: ["expiryDate"], error: "Ngày hết hạn phải bằng hoặc sau ngày cấp" },
  );
export type CertificationInput = z.infer<typeof certificationSchema>;
const certificationsSchema = z
  .array(certificationSchema)
  .max(MAX_CERTIFICATIONS, { error: "Chứng nhận chỉ nhận tối đa 20 mục" })
  .nullish()
  .transform((value) => value ?? [])
  .superRefine((rows, context) => {
    const numbers = new Set<string>();
    rows.forEach((row, index) => {
      if (numbers.has(row.certificateNo))
        context.addIssue({
          code: "custom",
          path: [index, "certificateNo"],
          message: "Số chứng nhận không được trùng trong hồ sơ",
        });
      numbers.add(row.certificateNo);
    });
  });
const common = {
  name: requiredText(255),
  email: optionalText(254)
    .transform((value) => value?.toLowerCase() ?? null)
    .refine(
      (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      { error: "Email liên hệ không hợp lệ" },
    ),
  phone: optionalText(30),
  address: optionalText(4000),
};
export const schoolProfileSchema = z.strictObject({
  ...common,
  code: optionalText(80),
});
export const supplierProfileSchema = z.strictObject({
  ...common,
  taxCode: optionalText(80),
  certifications: certificationsSchema,
});
export type OrganizationProfile = Pick<
  z.infer<typeof schoolProfileSchema>,
  "name" | "email" | "phone" | "address"
>;
export type OnboardingProfile =
  | { requestType: "SCHOOL"; profileData: z.infer<typeof schoolProfileSchema> }
  | {
      requestType: "SUPPLIER";
      profileData: z.infer<typeof supplierProfileSchema>;
    };

export function validateOnboarding(
  value: unknown,
  requestType: "SCHOOL" | "SUPPLIER",
): OnboardingProfile {
  return requestType === "SCHOOL"
    ? { requestType, profileData: parseRequest(schoolProfileSchema, value) }
    : { requestType, profileData: parseRequest(supplierProfileSchema, value) };
}

export const retainedDocumentSchema = z.strictObject({
  id: requestUuidSchema,
  field: requiredText(40),
});
const submissionMetadata = {
  retainedDocuments: z
    .array(retainedDocumentSchema)
    .max(MAX_PROFILE_DOCUMENTS, {
      error: "Danh sách tệp giữ lại vượt giới hạn",
    })
    .default([]),
  expectedUpdatedAt: requiredText(50)
    .refine((value) => Number.isFinite(new Date(value).getTime()), {
      error: "Phiên bản hồ sơ không hợp lệ",
    })
    .transform((value) => new Date(value))
    .optional()
    .transform((value) => value ?? null),
};
function checkRetained(
  value: { retainedDocuments: z.infer<typeof retainedDocumentSchema>[] },
  allowed: Set<string>,
  context: z.RefinementCtx,
) {
  const ids = new Set<string>();
  value.retainedDocuments.forEach((row, index) => {
    if (!allowed.has(row.field))
      context.addIssue({
        code: "custom",
        path: ["retainedDocuments", index, "field"],
        message: "Tệp giữ lại không thuộc trường hồ sơ",
      });
    if (ids.has(row.id))
      context.addIssue({
        code: "custom",
        path: ["retainedDocuments", index, "id"],
        message: "Tệp giữ lại bị lặp",
      });
    ids.add(row.id);
  });
}
export const schoolSubmissionSchema = schoolProfileSchema
  .extend(submissionMetadata)
  .superRefine((value, context) =>
    checkRetained(value, new Set(["legalDocument"]), context),
  )
  .transform(({ retainedDocuments, expectedUpdatedAt, ...profileData }) => ({
    profile: { requestType: "SCHOOL" as const, profileData },
    retained: retainedDocuments,
    expected: expectedUpdatedAt,
  }));
export const supplierSubmissionSchema = supplierProfileSchema
  .extend(submissionMetadata)
  .superRefine((value, context) =>
    checkRetained(
      value,
      new Set(value.certifications.map((_, index) => `certificate_${index}`)),
      context,
    ),
  )
  .transform(({ retainedDocuments, expectedUpdatedAt, ...profileData }) => ({
    profile: { requestType: "SUPPLIER" as const, profileData },
    retained: retainedDocuments,
    expected: expectedUpdatedAt,
  }));
export function validateSubmission(
  value: unknown,
  requestType: "SCHOOL" | "SUPPLIER",
) {
  return requestType === "SCHOOL"
    ? parseRequest(schoolSubmissionSchema, value)
    : parseRequest(supplierSubmissionSchema, value);
}
const multipartSchema = z.strictObject({
  profile: z
    .string({ error: "Multipart cần trường profile chứa JSON" })
    .transform((value, context): unknown => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({
          code: "custom",
          message: "profile không phải JSON hợp lệ",
        });
        return z.NEVER;
      }
    }),
});
export function readProfileBody(body: unknown, multipart: boolean): unknown {
  return multipart ? parseRequest(multipartSchema, body).profile : body;
}
export const registrationParamsSchema = z.strictObject({
  id: requestUuidSchema,
});
export const ownDocumentParamsSchema = z.strictObject({
  documentId: requestUuidSchema,
});
export const reviewDocumentParamsSchema = z.strictObject({
  id: requestUuidSchema,
  documentId: requestUuidSchema,
});
const versionSchema = z
  .string({ error: "Phiên bản hồ sơ không hợp lệ" })
  .regex(/^[a-f0-9]{64}$/, { error: "Phiên bản hồ sơ không hợp lệ" });
export const approveBodySchema = z.strictObject({
  expectedReviewVersion: versionSchema,
});
export const rejectBodySchema = approveBodySchema.extend({
  rejectionReason: requiredText(4000),
});
export const approveRequestSchema = registrationParamsSchema.extend(
  approveBodySchema.shape,
);
export const rejectRequestSchema = registrationParamsSchema.extend(
  rejectBodySchema.shape,
);
