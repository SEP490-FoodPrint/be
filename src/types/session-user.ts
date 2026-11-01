import type { AuthPrincipal } from "./auth";

interface RegistrationState {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: Date;
  rejectionReason: string | null;
}

interface PersonalContact {
  email: string;
  phone: string | null;
}

export type SessionUser = PersonalContact &
  (
    | (AuthPrincipal & {
        status: "ACTIVE";
        onboardingRequired: false;
        registrationRequest: RegistrationState | null;
        emailVerifiedAt: Date | null;
      })
    | (Omit<AuthPrincipal, "permissions"> & {
        status: "UNVERIFIED";
        onboardingRequired: true;
        registrationRequest: RegistrationState | null;
        emailVerifiedAt: Date;
      })
  );
