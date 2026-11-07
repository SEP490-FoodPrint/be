import type { AuthPrincipal } from "../../types/auth";
import { ROLES, ORG_TYPES } from "../../constants/roles";
import { listScopes } from "../../utils/resource-access";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import { getPrisma } from "../../utils/database";
import {
  createSupplierRepository,
  type SupplierRepository,
  type SupplierRow,
} from "./supplier.repository";
import type {
  SupplierListRequestDTO,
  SupplierDetailRequestDTO,
  SupplierSummaryRequestDTO,
} from "./supplier.request.dto";
import type {
  SupplierItemResponseDTO,
  SupplierListResponseDTO,
  SupplierSummaryResponseDTO,
} from "./supplier.response.dto";
function map(row: SupplierRow): SupplierItemResponseDTO {
  return {
    id: row.id,
    name: row.name,
    taxCode: row.taxCode,
    email: row.email,
    phone: row.phone,
    address: row.address,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export function createSupplierService(
  data: SupplierRepository = createSupplierRepository(),
  connect = getPrisma,
) {
  return {
    async getAll(
      q: SupplierListRequestDTO,
      p: AuthPrincipal,
    ): Promise<SupplierListResponseDTO> {
      const scope = listScopes.supplier(p);
      return withReadTransaction(async (tx) => {
        const result = await data.list(tx, scope, q);
        return {
          items: result.items.map(map),
          pagination: {
            page: q.page,
            limit: q.limit,
            total: result.total,
            hasNext:
              (q.page - 1) * q.limit + result.items.length < result.total,
          },
        };
      }, connect);
    },
    async getSummary(
      _q: SupplierSummaryRequestDTO,
      p: AuthPrincipal,
    ): Promise<SupplierSummaryResponseDTO> {
      const scope = listScopes.supplier(p);
      if (p.role !== ROLES.SYSTEM_ADMIN || p.orgType !== ORG_TYPES.SYSTEM)
        throw new HttpError(403, "Chỉ System Admin được xem tổng quan");
      return withReadTransaction(async (tx) => {
        const counts = await data.summary(tx, scope);
        return { total: counts.total, activeCount: counts.activeCount };
      }, connect);
    },
    async getById(
      q: SupplierDetailRequestDTO,
      p: AuthPrincipal,
    ): Promise<SupplierItemResponseDTO> {
      const scope = listScopes.supplier(p);
      return withReadTransaction(async (tx) => {
        const row = await data.detail(tx, scope, q.id);
        if (!row) throw new HttpError(404, "Không tìm thấy nhà cung cấp");
        return map(row);
      }, connect);
    },
  };
}
export const supplierService = createSupplierService();
export type SupplierService = ReturnType<typeof createSupplierService>;
