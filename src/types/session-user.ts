import type { AuthPrincipal } from "./auth";

interface RegistrationState {
  /** Mã hồ sơ đã lưu: FP-REG-… (cũ) hoặc FP-RG-NNNNN. */
  code: string;
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: Date;
  rejectionReason: string | null;
}

interface PersonalContact {
  phone: string | null;
  /** Tên đơn vị của tài khoản (trường / nhà cung cấp / đơn vị ATTP xã), lấy từ dữ liệu đăng ký. */
  organizationName?: string | null;
}

export type SessionUser = PersonalContact &
  (
    | (AuthPrincipal & {
        status: "ACTIVE";
        email: string;
        onboardingRequired: false;
        registrationRequest: RegistrationState | null;
        emailVerifiedAt: Date | null;
      })
    | (Omit<AuthPrincipal, "permissions"> & {
        status: "UNVERIFIED";
        email: string;
        onboardingRequired: true;
        registrationRequest: RegistrationState | null;
        emailVerifiedAt: Date;
      })
    /** Cán bộ ATTP do System Admin cấp, chưa cập nhật email (specs/authority-officer-accounts FR-004). */
    | (Omit<AuthPrincipal, "permissions"> & {
        status: "UNVERIFIED";
        email: null;
        onboardingRequired: false;
        registrationRequest: null;
        emailVerifiedAt: null;
      })
  );
