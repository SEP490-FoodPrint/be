import { HttpError } from "../../utils/http-error";
import type { OnboardingDocument } from "../../utils/onboarding-documents";
import { MAX_PROFILE_DOCUMENTS } from "../../utils/onboarding-documents";
import { validateSubmission } from "./onboarding.validation";
import type { z } from "zod";
import type { retainedDocumentSchema } from "./onboarding.validation";

export type RetainedDocument = z.infer<typeof retainedDocumentSchema>;
export const readSubmission = validateSubmission;

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
