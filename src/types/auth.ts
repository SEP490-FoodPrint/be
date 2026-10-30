import type { ORG_TYPES } from "../constants/roles";
export type OrganizationType = (typeof ORG_TYPES)[keyof typeof ORG_TYPES];
export interface AuthPrincipal {
  id: string;
  username: string;
  fullName: string;
  roleId: string;
  role: string;
  orgType: OrganizationType;
  schoolId: string | null;
  supplierId: string | null;
  communeFoodSafetyUnitId: string | null;
  permissions: readonly string[];
}
