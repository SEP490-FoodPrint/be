import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import { readListPage } from "../../utils/list-query";
import { withReadTransaction } from "../../utils/read-transaction";
import { HttpError } from "../../utils/http-error";
import {
  createUserRepository,
  type UserRepository,
  type ListReader,
} from "./user.repository";
import type {
  UserListRequestDTO,
  UserSchoolRequestDTO,
} from "./user.request.dto";
import type {
  UserListResponseDTO,
  UserSchoolResponseDTO,
} from "./user.response.dto";
export function createUserService(
  read?: ListReader,
  repository?: UserRepository,
  run = withReadTransaction,
) {
  const data = repository ?? createUserRepository(read);
  return {
    async getAll(
      query: UserListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<UserListResponseDTO> {
      const scope = listScopes["user"](principal);
      const page = await readListPage(() => data.list(query, scope), query);
      return {
        items: page.items.map((row) => ({
          id: row.id,
          username: row.username,
          fullName: row.fullName,
          roleId: row.roleId,
          schoolId: row.schoolId,
          supplierId: row.supplierId,
          communeFoodSafetyUnitId: row.communeFoodSafetyUnitId,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: page.pagination,
      };
    },
    async getBySchool(
      input: UserSchoolRequestDTO,
      principal: AuthPrincipal,
    ): Promise<UserSchoolResponseDTO> {
      const scope = listScopes["user"](principal);
      if (principal.orgType === "SUPPLIER")
        throw new HttpError(403, "Không có phạm vi tài khoản trường");
      const parent =
        principal.orgType === "SYSTEM"
          ? { kind: "system" as const }
          : {
              kind:
                principal.orgType === "SCHOOL"
                  ? ("school" as const)
                  : ("supplier" as const),
              id: principal.schoolId ?? principal.supplierId!,
            };
      return run(async (tx) => {
        const result = await data.schoolPage(
          tx,
          input.query,
          input.params.schoolId,
          scope,
          parent,
        );
        if (!result) throw new HttpError(404, "Không tìm thấy trường học");
        const items = result.items.map((row) => ({
          id: row.id,
          schoolId: row.schoolId,
          fullName: row.fullName,
          email: row.email,
          roleCode: row.Role.code,
          roleName: row.Role.name,
          status: row.status,
        }));
        const { page, limit } = input.query;
        return {
          items,
          pagination: {
            page,
            limit,
            total: result.total,
            hasNext: (page - 1) * limit + items.length < result.total,
          },
        };
      });
    },
  };
}
export const userService = createUserService();
export type UserService = ReturnType<typeof createUserService>;
