import { createAuthenticate } from "../../src/middlewares/auth.middleware";
import type { AuthPrincipal } from "../../src/types/auth";
import { HttpError } from "../../src/utils/http-error";

process.env.JWT_SECRET ??= "foodprint-unit-test-only-secret";

export const testAdmin: AuthPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "unit-admin",
  fullName: "Unit Admin",
  roleId: "00000000-0000-4000-8000-000000000002",
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: [
    "user.manage",
    "inventory.view",
    "traceability.view",
    "class_allergy.view",
  ],
};
export const testStaff: AuthPrincipal = {
  ...testAdmin,
  id: "00000000-0000-4000-8000-000000000003",
  role: "SCHOOL_KITCHEN_STAFF",
  orgType: "SCHOOL",
  schoolId: "00000000-0000-4000-8000-000000000004",
  permissions: [],
};
export const testAuthenticate = createAuthenticate((id) => {
  if (id === testAdmin.id) return Promise.resolve(testAdmin);
  if (id === testStaff.id) return Promise.resolve(testStaff);
  return Promise.reject(new HttpError(401, "Tài khoản không tồn tại"));
});
