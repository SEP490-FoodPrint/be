import type { WardLocationDTO } from "../../utils/ward-location";

/** Đơn vị ATTP sau khi gắn phường/xã phụ trách. */
export interface AuthorityLocationResponseDTO {
  id: string;
  code: string;
  name: string;
  status: string;
  location: { id: string; code: string; name: string };
}

/** Trường/NCC sau khi System Admin gắn phường/xã (FR-008). */
export interface OrganizationLocationResponseDTO {
  id: string;
  name: string;
  location: WardLocationDTO;
}

/** Trường thuộc địa bàn ATTP (FR-009). */
export interface AuthoritySchoolDTO {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: "ACTIVE" | "INACTIVE";
  location: WardLocationDTO | null;
}

/** NCC còn hoạt động, liên kết `ACTIVE`/`SUSPENDED` với trường (FR-011). */
export interface AuthoritySchoolSupplierDTO {
  id: string;
  name: string;
  taxCode: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  location: WardLocationDTO | null;
  intakeState: string;
  relationshipStatus: "ACTIVE" | "SUSPENDED";
  linkedAt: string;
  suspendedAt: string | null;
}

export interface AuthoritySchoolDetailDTO extends AuthoritySchoolDTO {
  suppliers: AuthoritySchoolSupplierDTO[];
}
