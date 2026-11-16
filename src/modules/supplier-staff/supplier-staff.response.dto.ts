import type { AccountStatus } from "../../generated/prisma/enums";

export interface StaffListItem {
  id: string;
  username: string;
  fullName: string;
  email: string;
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
