import { testAdmin, testStaff } from "./authorization";
import type { AuthPrincipal } from "../../src/types/auth";
import { createAccountLifecycleService } from "../../src/modules/account-lifecycle/account-lifecycle.service";
import type { AccountLifecycleRepository } from "../../src/modules/account-lifecycle/account-lifecycle.repository";

export { startHttp as startLifecycleHttp } from "./http";

export function lifecycleService(repository: AccountLifecycleRepository) {
  return createAccountLifecycleService(repository);
}

export function lifecycleAdmin(
  overrides: Partial<AuthPrincipal> = {},
): AuthPrincipal {
  return { ...testAdmin, ...overrides };
}

export function lifecycleSchoolStaff(
  overrides: Partial<AuthPrincipal> = {},
): AuthPrincipal {
  return { ...testStaff, ...overrides };
}
