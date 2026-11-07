import type { AccountStatus } from "../../generated/prisma/enums";
export type UserItemDTO = {
  id: string;
  username: string;
  fullName: string;
  roleId: string;
  schoolId: string | null;
  supplierId: string | null;
  communeFoodSafetyUnitId: string | null;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
};
export type UserListResponseDTO = {
  items: UserItemDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
};
export type UserSchoolResponseDTO = {
  items: {
    id: string;
    schoolId: string | null;
    fullName: string;
    email: string;
    roleCode: string;
    roleName: string;
    status: AccountStatus;
  }[];
  pagination: { page: number; limit: number; total: number; hasNext: boolean };
};
