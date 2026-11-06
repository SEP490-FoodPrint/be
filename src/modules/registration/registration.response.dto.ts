export interface RegistrationApplicantResponseDTO {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: "UNVERIFIED" | "ACTIVE" | "INACTIVE" | "LOCKED" | "DEACTIVATED";
  emailVerifiedAt: string | null;
}

export interface RegistrationListItemResponseDTO {
  registrationID: string;
  id: string;
  applicantUserId: string;
  applicantUser: RegistrationApplicantResponseDTO;
  requestType: "SCHOOL" | "SUPPLIER";
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt: string | null;
  updatedAt: string;
}

export interface RegistrationListResponseDTO {
  items: RegistrationListItemResponseDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
