import type { WardLocationDTO } from "../../utils/ward-location";

/** Tài khoản cán bộ ATTP kèm đơn vị và phường/xã phụ trách (FR-002, FR-003). */
export interface AuthorityOfficerDTO {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: "UNVERIFIED" | "ACTIVE" | "INACTIVE" | "LOCKED" | "DEACTIVATED";
  /** `true` khi cán bộ chưa cập nhật email (chưa dùng được hệ thống). */
  emailSetupRequired: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
  unit: {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE" | "INACTIVE";
  } | null;
  location: WardLocationDTO | null;
}

export interface AuthorityOfficerListDTO {
  items: AuthorityOfficerDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
