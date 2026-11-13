import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import { readListPage } from "../../utils/list-query";
import {
  assertPermission,
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { createIntakeAccessService } from "../account-lifecycle/intake-access.service";
import {
  createSupplyOrderRepository,
  type SupplyOrderRepository,
  type AcceptedOrderRow,
} from "./supply-order.repository";
import type {
  SupplyOrderAcceptParamsRequestDTO,
  SupplyOrderListRequestDTO,
} from "./supply-order.request.dto";
import type {
  SupplyOrderAcceptResponseDTO,
  SupplyOrderListResponseDTO,
} from "./supply-order.response.dto";

type Dependencies = {
  transaction: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  guard: Pick<ReturnType<typeof createIntakeAccessService>, "assertAccess">;
};
function mapAccepted(order: AcceptedOrderRow): SupplyOrderAcceptResponseDTO {
  return {
    id: order.id,
    status: order.status,
    acceptedByUserId: order.acceptedByUserId,
    acceptedAt: order.acceptedAt?.toISOString() ?? null,
  };
}
export function createSupplyOrderService(
  repository: SupplyOrderRepository = createSupplyOrderRepository(),
  dependencies?: Dependencies,
) {
  const transaction: Dependencies["transaction"] =
    dependencies?.transaction ??
    (async (fn) =>
      authorizationTransaction(
        await databaseOperation(() => repository.connect()),
        fn,
      ));
  const guard = dependencies?.guard ?? createIntakeAccessService();
  return {
    async getAll(
      query: SupplyOrderListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplyOrderListResponseDTO> {
      const scope = listScopes["supply-order"](principal);
      const page = await readListPage(
        () => repository.list(query, scope),
        query,
      );
      return {
        items: page.items.map((row) => ({
          id: row.id,
          requestNo: row.requestNo,
          schoolId: row.schoolId,
          supplierId: row.supplierId,
          status: row.status,
          acceptedAt: row.acceptedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: page.pagination,
      };
    },
    async accept(
      params: SupplyOrderAcceptParamsRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplyOrderAcceptResponseDTO> {
      if (principal.orgType !== "SUPPLIER" || !principal.supplierId)
        throw new HttpError(403, "Thao tác yêu cầu nhà cung cấp");
      assertPermission(principal, "supply_request.accept");
      return transaction(async (tx) => {
        const actor = await guard.assertAccess(tx, principal, {
          operation: "SUPPLIER_ACCEPT_ORDER",
          orderId: params.id,
        });
        if (actor.orgType !== "SUPPLIER" || !actor.supplierId)
          throw new HttpError(403, "Phạm vi nhà cung cấp đã thay đổi");
        const order = await repository.findForSupplier(
          tx,
          params.id,
          actor.supplierId,
        );
        if (!order) throw new HttpError(404, "Không tìm thấy đơn đặt hàng");
        if (order.status === "ACCEPTED" || order.status === "IN_PROGRESS")
          return mapAccepted(order);
        if (order.status !== "SENT")
          throw new HttpError(409, "Đơn hàng không ở trạng thái chờ nhận");
        const count = await repository.accept(
          tx,
          order.id,
          actor.supplierId,
          actor.id,
          new Date(),
        );
        if (count !== 1)
          throw new HttpError(409, "Trạng thái đơn hàng đã thay đổi");
        const updated = await repository.findForSupplier(
          tx,
          order.id,
          actor.supplierId,
        );
        if (!updated) throw new HttpError(409, "Không thể xác nhận đơn hàng");
        return mapAccepted(updated);
      });
    },
  };
}
export const supplyOrderService = createSupplyOrderService();
export type SupplyOrderService = ReturnType<typeof createSupplyOrderService>;
