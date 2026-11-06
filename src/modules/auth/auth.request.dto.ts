import type { z } from "zod";
import type {
  schoolSubmissionSchema,
  supplierSubmissionSchema,
  registrationParamsSchema,
  ownDocumentParamsSchema,
  reviewDocumentParamsSchema,
  approveRequestSchema,
  rejectRequestSchema,
} from "./onboarding.validation";
import type { loginSchema } from "./session.validation";
import type { profileUpdateSchema } from "./profile.validation";
export type OnboardingSubmitRequestDTO =
  | z.infer<typeof schoolSubmissionSchema>
  | z.infer<typeof supplierSubmissionSchema>;
export type RegistrationParamsRequestDTO = z.infer<
  typeof registrationParamsSchema
>;
export type OwnDocumentParamsRequestDTO = z.infer<
  typeof ownDocumentParamsSchema
>;
export type ReviewDocumentRequestDTO = z.infer<
  typeof reviewDocumentParamsSchema
>;
export type RegistrationApproveRequestDTO = z.infer<
  typeof approveRequestSchema
>;
export type RegistrationRejectRequestDTO = z.infer<typeof rejectRequestSchema>;
export type LoginRequestDTO = z.infer<typeof loginSchema>;
export type ProfileUpdateRequestDTO = z.infer<typeof profileUpdateSchema>;
