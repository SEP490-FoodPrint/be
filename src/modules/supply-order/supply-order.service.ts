import type { Prisma } from "../../generated/prisma/client";
import { ORG_TYPES, ROLES } from "../../constants/roles";
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
  type SupplierOrderListRow,
} from "./supply-order.repository";
import type {
  SupplyOrderAcceptParamsRequestDTO,
  SupplyOrderListRequestDTO,
  SupplyOrderDetailParamsRequestDTO,
} from "./supply-order.request.dto";
import type {
  SupplyOrderAcceptResponseDTO,
  SupplyOrderListResponseDTO,
  SupplierOrderListItemResponseDTO,
  SupplierOrderListResponseDTO,
  SupplierOrderDetailResponseDTO,
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
function assertSupplierActor(
  principal: AuthPrincipal,
): asserts principal is AuthPrincipal & { supplierId: string } {
  if (
    principal.orgType !== ORG_TYPES.SUPPLIER ||
    !principal.supplierId ||
    principal.schoolId !== null ||
    principal.communeFoodSafetyUnitId !== null ||
    (principal.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN &&
      principal.role !== ROLES.INGREDIENT_SUPPLIER_STAFF)
  )
    throw new HttpError(
      403,
      "Thao tác yêu cầu admin hoặc nhân viên nhà cung cấp",
    );
}
function mapSupplierList(
  order: SupplierOrderListRow,
): SupplierOrderListItemResponseDTO {
  return {
    id: order.id,
    requestNo: order.requestNo,
    schoolId: order.schoolId,
    supplierId: order.supplierId,
    schoolName: order.School.name,
    status: order.status,
    requestedDeliveryDate:
      order.requestedDeliveryDate?.toISOString().slice(0, 10) ?? null,
    sentAt: order.sentAt?.toISOString() ?? null,
    acceptedAt: order.acceptedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
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
    ): Promise<SupplyOrderListResponseDTO | SupplierOrderListResponseDTO> {
      if (principal.orgType === ORG_TYPES.SUPPLIER) {
        assertSupplierActor(principal);
        const scope = listScopes["supply-order"](principal);
        const page = await readListPage(
          () => repository.listForSupplier(query, scope),
          { page: query.page, limit: query.limit },
        );
        return {
          items: page.items.map(mapSupplierList),
          pagination: page.pagination,
        };
      }
      const scope = listScopes["supply-order"](principal);
      if (query.status !== undefined)
        throw new HttpError(400, "Chỉ hỗ trợ tham số page và limit");
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
    async getDetail(
      params: SupplyOrderDetailParamsRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierOrderDetailResponseDTO> {
      assertSupplierActor(principal);
      assertPermission(principal, "supply_request.view");
      const order = await databaseOperation(() =>
        repository.findDetailForSupplier(params.id, principal.supplierId),
      );
      if (!order || order.status === "DRAFT")
        throw new HttpError(404, "Không tìm thấy đơn đặt hàng");
      return {
        ...mapSupplierList(order),
        note: order.note,
        acceptedByUserId: order.acceptedByUserId,
        items: order.supplyRequestItems.map((item) => ({
          id: item.id,
          ingredientEntryId: item.ingredientEntryId,
          ingredientName: item.IngredientEntry.Ingredient.name,
          requestedQuantity: item.requestedQuantity.toString(),
          unit: item.unit,
          note: item.note,
        })),
      };
    },
    async accept(
      params: SupplyOrderAcceptParamsRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplyOrderAcceptResponseDTO> {
      assertSupplierActor(principal);
      assertPermission(principal, "supply_request.accept");
      return transaction(async (tx) => {
        const actor = await guard.assertAccess(tx, principal, {
          operation: "SUPPLIER_ACCEPT_ORDER",
          orderId: params.id,
        });
        assertSupplierActor(actor);
        assertPermission(actor, "supply_request.accept");
        if (
          actor.id !== principal.id ||
          actor.supplierId !== principal.supplierId ||
          actor.role !== principal.role ||
          actor.roleId !== principal.roleId
        )
          throw new HttpError(403, "Phạm vi nhà cung cấp đã thay đổi");
        const order = await repository.findForSupplier(
          tx,
          params.id,
          actor.supplierId,
        );
        if (!order || order.status === "DRAFT")
          throw new HttpError(404, "Không tìm thấy đơn đặt hàng");
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
