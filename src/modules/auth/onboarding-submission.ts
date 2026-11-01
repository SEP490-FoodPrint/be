import { objectBody, text, uuid } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";
import type { OnboardingDocument } from "../../utils/onboarding-documents";
import { MAX_PROFILE_DOCUMENTS } from "../../utils/onboarding-documents";
import { validateOnboarding } from "./onboarding.validation";

export interface RetainedDocument {
  id: string;
  field: string;
}

export function readSubmission(
  value: unknown,
  requestType: "SCHOOL" | "SUPPLIER",
) {
  const body = objectBody(value, [
    "name",
    "email",
    "phone",
    "address",
    "retainedDocuments",
    "expectedUpdatedAt",
    ...(requestType === "SCHOOL" ? ["code"] : ["taxCode", "certifications"]),
  ]);
  const { retainedDocuments = [], expectedUpdatedAt, ...fields } = body;
  const profile = validateOnboarding(fields, requestType);
  const allowed = new Set(
    profile.requestType === "SCHOOL"
      ? ["legalDocument"]
      : profile.profileData.certifications.map(
          (_, index) => `certificate_${index}`,
        ),
  );
  if (
    !Array.isArray(retainedDocuments) ||
    retainedDocuments.length > MAX_PROFILE_DOCUMENTS
  )
    throw new HttpError(400, "Danh sách tệp giữ lại không hợp lệ");
  const ids = new Set<string>();
  const retained = retainedDocuments.map((value: unknown): RetainedDocument => {
    const row = objectBody(value, ["id", "field"]);
    const id = uuid(row.id),
      field = text(row.field, 40);
    if (!allowed.has(field) || ids.has(id))
      throw new HttpError(
        400,
        "Tệp giữ lại không thuộc trường hồ sơ hoặc bị lặp",
      );
    ids.add(id);
    return { id, field };
  });
  const expected =
    expectedUpdatedAt === undefined
      ? null
      : new Date(text(expectedUpdatedAt, 50));
  if (expected && !Number.isFinite(expected.getTime()))
    throw new HttpError(400, "Phiên bản hồ sơ không hợp lệ");
  return { profile, retained, expected };
}

/** Resolve only documents owned by the locked application; never trust storage metadata from the client. */
export function retainDocuments(
  existing: OnboardingDocument[],
  retained: RetainedDocument[],
  files: Express.Multer.File[],
): OnboardingDocument[] {
  if (retained.length + files.length > MAX_PROFILE_DOCUMENTS)
    throw new HttpError(
      400,
      `Hồ sơ chỉ nhận tối đa ${MAX_PROFILE_DOCUMENTS} tệp, gồm cả tệp giữ lại`,
    );
  return retained.map(({ id, field }) => {
    const document = existing.find((document) => document.id === id);
    if (!document)
      throw new HttpError(400, "Tệp giữ lại không thuộc hồ sơ của bạn");
    return { ...document, field };
  });
}
