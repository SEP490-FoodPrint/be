import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import { readListPage } from "../../utils/list-query";
import { withReadTransaction } from "../../utils/read-transaction";
import { HttpError } from "../../utils/http-error";
import {
  createClassRepository,
  type ClassRepository,
  type ListReader,
} from "./class.repository";
import type {
  ClassListRequestDTO,
  ClassSchoolRequestDTO,
} from "./class.request.dto";
import type {
  ClassListResponseDTO,
  ClassSchoolResponseDTO,
} from "./class.response.dto";
export function createClassService(
  read?: ListReader,
  repository?: ClassRepository,
  run = withReadTransaction,
) {
  const data = repository ?? createClassRepository(read);
  return {
    async getAll(
      query: ClassListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ClassListResponseDTO> {
      const scope = listScopes["class"](principal);
      const page = await readListPage(() => data.list(query, scope), query);
      return {
        items: page.items.map((row) => ({
          id: row.id,
          schoolId: row.schoolId,
          name: row.name,
          academicYear: row.academicYear,
          registeredMealPortions: row.registeredMealPortions,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: page.pagination,
      };
    },
    async getBySchool(
      input: ClassSchoolRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ClassSchoolResponseDTO> {
      const scope = listScopes["class"](principal);

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
          name: row.name,
          academicYear: row.academicYear,
          registeredMealPortions: row.registeredMealPortions,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
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
export const classService = createClassService();
export type ClassService = ReturnType<typeof createClassService>;
