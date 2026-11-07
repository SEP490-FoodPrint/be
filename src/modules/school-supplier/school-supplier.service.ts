import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import { readListPage } from "../../utils/list-query";
import { withReadTransaction } from "../../utils/read-transaction";
import { HttpError } from "../../utils/http-error";
import {
  createSchoolSupplierRepository,
  type SchoolSupplierRepository,
  type ListReader,
} from "./school-supplier.repository";
import type {
  SchoolSupplierListRequestDTO,
  SchoolSupplierSchoolRequestDTO,
} from "./school-supplier.request.dto";
import type {
  SchoolSupplierListResponseDTO,
  SchoolSupplierSchoolResponseDTO,
} from "./school-supplier.response.dto";
export function createSchoolSupplierService(
  read?: ListReader,
  repository?: SchoolSupplierRepository,
  run = withReadTransaction,
) {
  const data = repository ?? createSchoolSupplierRepository(read);
  return {
    async getAll(
      query: SchoolSupplierListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SchoolSupplierListResponseDTO> {
      const scope = listScopes["school-supplier"](principal);
      const page = await readListPage(() => data.list(query, scope), query);
      return {
        items: page.items.map((row) => ({
          id: row.id,
          schoolId: row.schoolId,
          supplierId: row.supplierId,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          linkedAt: row.linkedAt.toISOString(),
          unlinkedAt: row.unlinkedAt?.toISOString() ?? null,
          suspendedAt: row.suspendedAt?.toISOString() ?? null,
        })),
        pagination: page.pagination,
      };
    },
    async getBySchool(
      input: SchoolSupplierSchoolRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SchoolSupplierSchoolResponseDTO> {
      const scope = listScopes["school-supplier"](principal);

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
          supplierId: row.supplierId,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          linkedAt: row.linkedAt.toISOString(),
          unlinkedAt: row.unlinkedAt?.toISOString() ?? null,
          suspendedAt: row.suspendedAt?.toISOString() ?? null,
          supplierName: row.Supplier.name,
          supplierStatus: row.Supplier.status,
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
export const schoolSupplierService = createSchoolSupplierService();
export type SchoolSupplierService = ReturnType<
  typeof createSchoolSupplierService
>;
