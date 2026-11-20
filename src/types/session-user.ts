import type { AuthPrincipal } from "./auth";

interface RegistrationState {
  registrationNumber: bigint;
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: Date;
  rejectionReason: string | null;
}

interface PersonalContact {
  email: string;
  phone: string | null;
  /** Tên đơn vị của tài khoản (trường / nhà cung cấp / đơn vị ATTP xã), lấy từ dữ liệu đăng ký. */
  organizationName?: string | null;
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
