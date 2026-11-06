import type { OnboardingProfile } from "./onboarding.validation";
import type { SessionUser } from "../../types/session-user";

export interface OnboardingResponseDTO {
  id: string;
  registrationID: string;
  applicantUserId: string;
  requestType: "SCHOOL" | "SUPPLIER";
  status: "PENDING" | "APPROVED" | "REJECTED";
  profileData: OnboardingProfile["profileData"];
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  updatedAt: string;
  documents: {
    id: string;
    field: string;
    format: string;
    fileName: string;
    bytes: number;
  }[];
}
export interface ReviewResponseDTO extends OnboardingResponseDTO {
  applicantUser: {
    id: string;
    username: string;
    fullName: string;
    email: string;
    phone: string | null;
    status: "UNVERIFIED" | "ACTIVE" | "INACTIVE" | "LOCKED" | "DEACTIVATED";
    emailVerifiedAt: string | null;
  };
  reviewedByUserId: string | null;
  reviewedByUser: { id: string; fullName: string } | null;
  reviewVersion: string;
}
export interface SubmissionResponseDTO extends OnboardingResponseDTO {
  accountStatus: "UNVERIFIED";
}
export interface ReviewDecisionResponseDTO extends ReviewResponseDTO {
  accountStatus: "ACTIVE" | "UNVERIFIED";
  schoolId?: string;
  supplierId?: string;
  emailNotification: { id: string; status: string };
}
type PublicSession<T> = T extends SessionUser
  ? Omit<T, "registrationRequest" | "emailVerifiedAt"> & {
      registrationRequest: {
        id: string;
        registrationID: string;
        status: "PENDING" | "APPROVED" | "REJECTED";
        submittedAt: string;
        rejectionReason: string | null;
      } | null;
      emailVerifiedAt: string | null;
    }
  : never;
export type SessionUserResponseDTO = PublicSession<SessionUser>;
