import type { AccountStatus, IntakeState } from "../../generated/prisma/enums";

export interface StaffListItem {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roleCode: "INGREDIENT_SUPPLIER_STAFF";
  roleName: string;
  status: AccountStatus;
}

export interface StaffDetail extends StaffListItem {
  supplierId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffList {
  /**
   * Trạng thái tiếp nhận của NCC; `PAUSED_FOR_FOOD_SAFETY_INSPECTION` khi đang bị
   * chế tài, lúc đó tạo/mở khóa nhân viên trả 409 (specs/frontend-api-gaps FR-003).
   */
  supplierIntakeState: IntakeState;
  items: StaffListItem[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

export interface StaffPermissionItem {
  id: string;
  code: string;
  name: string;
  module: string;
  action: string;
  description: string | null;
  isActive: boolean;
  enabled: boolean;
}

export interface StaffPermissions {
  userId: string;
  roleId: string;
  permissions: StaffPermissionItem[];
}
