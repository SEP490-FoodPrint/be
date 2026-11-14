import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  databaseOperation,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { ROLE_LABELS } from "../../constants/roles";
import {
  deliveryInspectionRepository as inspections,
  type DeliveryInspectionRow,
} from "./delivery.repository";
import type {
  DeliveryInspectionQueryDTO,
  DeliveryInspectionDecisionDTO,
} from "./delivery.request.dto";
import type {
  DeliveryInspectionDTO,
  DeliveryListResponseDTO,
} from "./delivery.response.dto";
import type { PrismaClient } from "../../generated/prisma/client";
import { listScopes } from "../../utils/resource-access";
import { Prisma } from "../../generated/prisma/client";
import { convertQuantity } from "../kitchen/kitchen.service";
import type { DeliveryInspectionDetailRow } from "./delivery.repository";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  deliveryNo: true,
  supplyRequestId: true,
  supplierId: true,
  status: true,
  expectedArrivalAt: true,
  arrivedAt: true,
  receivedAt: true,
  vehiclePlate: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  Supplier: {
    select: {
      id: true,
      name: true,
      phone: true,
    },
  },
  SupplyRequest: {
    select: {
      id: true,
      requestNo: true,
      requestedDeliveryDate: true,
      note: true,
      status: true,
    },
  },
  deliveryApprovals: {
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      roleId: true,
      userId: true,
      decision: true,
      reason: true,
      decidedAt: true,
      Role: { select: { code: true, name: true } },
      User: { select: { fullName: true } },
    },
  },
  deliveryItems: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      actualQuantity: true,
      unit: true,
      note: true,
      SupplyRequestItem: {
        select: {
          requestedQuantity: true,
          unit: true,
          IngredientEntry: {
            select: {
              handlingType: true,
              Ingredient: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.DeliverySelect;

type ListRow = Prisma.DeliveryGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.DeliveryFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.delivery.findMany(args);
};

export function createDeliveryService(read: ListReader = readFromDatabase) {
  return {
    async getAll(
      query: ListQuery,
      principal: AuthPrincipal,
    ): Promise<DeliveryListResponseDTO> {
      const where = listScopes["delivery"](principal);
      const page = await readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ createdAt: "desc" }],
          }),
        query,
      );
      return {
        items: page.items.map((row) => ({
          id: row.id,
          deliveryNo: row.deliveryNo,
          supplyRequestId: row.supplyRequestId,
          orderNo: row.SupplyRequest?.requestNo ?? null,
          requestNo: row.SupplyRequest?.requestNo ?? null,
          supplierId: row.supplierId,
          supplierName: row.Supplier?.name ?? null,
          supplierPhone: row.Supplier?.phone ?? null,
          status: row.status,
          vehiclePlate: row.vehiclePlate ?? null,
          expectedArrivalAt: row.expectedArrivalAt?.toISOString() ?? null,
          arrivedAt: row.arrivedAt?.toISOString() ?? null,
          receivedAt: row.receivedAt?.toISOString() ?? null,
          requestedDeliveryDate:
            row.SupplyRequest?.requestedDeliveryDate?.toISOString() ?? null,
          note: row.note ?? row.SupplyRequest?.note ?? null,
          deliveryApprovals:
            row.deliveryApprovals?.map((a) => ({
              id: a.id,
              roleId: a.roleId,
              roleCode: a.Role?.code ?? "",
              roleName: a.Role?.name ?? "",
              userId: a.userId,
              userName: a.User?.fullName ?? "",
              decision: a.decision,
              reason: a.reason ?? null,
              decidedAt: a.decidedAt.toISOString(),
            })) ?? [],
          deliveryItems:
            row.deliveryItems?.map((di) => ({
              id: di.id,
              actualQuantity: di.actualQuantity.toString(),
              unit: di.unit,
              note: di.note ?? null,
              requestedQuantity:
                di.SupplyRequestItem?.requestedQuantity?.toString() ?? null,
              ingredientName:
                di.SupplyRequestItem?.IngredientEntry?.Ingredient?.name ?? null,
              handlingType:
                di.SupplyRequestItem?.IngredientEntry?.handlingType ?? null,
            })) ?? [],
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: page.pagination,
      };
    },
  };
}

export const deliveryService = createDeliveryService();
export type DeliveryService = ReturnType<typeof createDeliveryService>;

export const deliveryInspectionRoles = [
  "SCHOOL_NUTRITION_OFFICER",
  "SCHOOL_KITCHEN_STAFF",
  "INGREDIENT_MANAGEMENT_DEPARTMENT",
  "PARENTS_COMMITTEE",
] as const;

function inspectionScope(principal: AuthPrincipal) {
  assertPermission(principal, "delivery.view");
  if (
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId ||
    !deliveryInspectionRoles.some((role) => role === principal.role)
  ) {
    throw new HttpError(
      403,
      "Chỉ bốn bộ phận kiểm tra đầu vào của trường được truy cập",
    );
  }
  return principal.schoolId;
}

function inspectionDTO(
  row: DeliveryInspectionRow,
  principal: AuthPrincipal,
): DeliveryInspectionDTO {
  return {
    id: row.id,
    deliveryNo: row.deliveryNo,
    supplyRequestId: row.supplyRequestId,
    requestNo: row.SupplyRequest.requestNo,
    supplierName: row.Supplier.name,
    status: row.status,
    expectedArrivalAt: row.expectedArrivalAt?.toISOString() ?? null,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    vehiclePlate: row.vehiclePlate,
    note: row.note,
    currentRole: principal.role,
    canInspect:
      principal.permissions.includes("delivery.inspect") &&
      (row.SupplyRequest._count?.deliveries ?? 0) <= 2 &&
      row.SupplyRequest.status !== "CANCELLED" &&
      ["ARRIVED", "PENDING_APPROVAL"].includes(row.status) &&
      !row.deliveryApprovals.some(
        (approval) => approval.roleId === principal.roleId,
      ),
    redeliveryRequiredCount: row.SupplyRequest._count?.deliveries ?? 0,
    redeliveryLimit: 2,
    cancellationNotice:
      row.SupplyRequest.status === "CANCELLED" ||
      (row.SupplyRequest._count?.deliveries ?? 0) > 2
        ? `Đơn ${row.SupplyRequest.requestNo}${row.SupplyRequest.status === "CANCELLED" ? " đã hủy phần chưa nhận" : " bị chặn nhận tiếp"}${(row.SupplyRequest._count?.deliveries ?? 0) > 2 ? " do tổng số lần phải giao lại vượt quá 2" : ""}. Không tiếp nhận thêm nguyên liệu của đơn này.`
        : null,
    requiredRoles: deliveryInspectionRoles.map((code) => ({
      code,
      name: ROLE_LABELS[code],
    })),
    deliveryApprovals: row.deliveryApprovals.map((approval) => ({
      id: approval.id,
      roleCode: approval.Role.code,
      roleName: approval.Role.name,
      userName: approval.User.fullName,
      decision: approval.decision,
      reason: approval.reason,
      decidedAt: approval.decidedAt.toISOString(),
    })),
  };
}

function inspectionDateRange(
  period: DeliveryInspectionQueryDTO["period"],
  now: Date,
  date?: string,
) {
  if (date) {
    const start = new Date(`${date}T00:00:00+07:00`);
    return {
      gte: start,
      lt: new Date(start.getTime() + 86400000),
    };
  }
  if (period === "ALL") return undefined;
  const schoolDay = new Date(now.getTime() + 7 * 3600000);
  const targetDate = schoolDay.toISOString().slice(0, 10);
  const start = new Date(`${targetDate}T00:00:00+07:00`);
  if (period === "week")
    start.setUTCDate(start.getUTCDate() - ((schoolDay.getUTCDay() + 6) % 7));
  return {
    gte: start,
    lt: new Date(start.getTime() + (period === "week" ? 7 : 1) * 86400000),
  };
}

function assertReceipt(
  row: DeliveryInspectionDetailRow,
  schoolId: string,
  now: Date,
) {
  if (
    row.supplierId !== row.SupplyRequest.supplierId ||
    !row.deliveryItems.length
  )
    throw new HttpError(
      409,
      "Thông tin Supplier hoặc mặt hàng giao chưa hợp lệ",
    );
  const today = new Date(now.getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 10);
  for (const item of row.deliveryItems) {
    const entry = item.SupplyRequestItem.IngredientEntry;
    if (
      item.SupplyRequestItem.supplyRequestId !== row.supplyRequestId ||
      entry.schoolId !== schoolId ||
      entry.Ingredient.supplierId !== row.supplierId ||
      !item.actualQuantity.gt(0) ||
      !item.ingredientLots.length
    )
      throw new HttpError(
        409,
        "Mặt hàng/lô giao phải khớp đơn cung ứng và trường",
      );
    let total = new Prisma.Decimal(0);
    for (const lot of item.ingredientLots) {
      if (
        lot.status !== "BLOCKED" ||
        !lot.availableQuantity.eq(0) ||
        !lot.receivedQuantity.gt(0) ||
        (lot.SourceFacility && lot.SourceFacility.supplierId !== row.supplierId)
      )
        throw new HttpError(
          409,
          "Lô nhận phải đang chặn, chưa có tồn kho và đúng Supplier",
        );
      const manufacture = lot.manufactureDate?.toISOString().slice(0, 10);
      const expiry = lot.expiryDate?.toISOString().slice(0, 10);
      if (
        (manufacture && manufacture > today) ||
        (expiry && expiry < today) ||
        (manufacture && expiry && manufacture > expiry)
      )
        throw new HttpError(
          409,
          "Ngày sản xuất/hạn dùng của lô không hợp lệ để tiếp nhận",
        );
      total = total.add(
        convertQuantity(lot.receivedQuantity, lot.unit, item.unit),
      );
    }
    if (!total.eq(item.actualQuantity))
      throw new HttpError(
        409,
        "Tổng lượng các lô không khớp lượng giao thực nhận",
      );
  }
}

export function createDeliveryInspectionService(
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
) {
  return {
    async decide(
      id: string,
      input: DeliveryInspectionDecisionDTO,
      principal: AuthPrincipal,
    ) {
      inspectionScope(principal);
      return withSchoolTransaction(
        await connect(),
        principal,
        "delivery.inspect",
        async (tx, actor, schoolId) => {
          inspectionScope(actor);
          if (!(await inspections.lock(tx, schoolId, id)))
            throw new HttpError(404, "Không tìm thấy đợt giao trong trường");
          let row = await inspections.detail(tx, schoolId, id);
          if (!row)
            throw new HttpError(404, "Không tìm thấy đợt giao trong trường");
          const existing = row.deliveryApprovals.find(
            (approval) => approval.roleId === actor.roleId,
          );
          if (
            row.deliveryApprovals.some(
              (approval) =>
                approval.userId === actor.id &&
                approval.roleId !== actor.roleId,
            )
          ) {
            throw new HttpError(
              409,
              "Bạn đã ký kiểm tra đợt này với vai trò khác; không được ký thay bộ phận khác",
            );
          }
          if (existing) {
            if (
              existing.userId !== actor.id ||
              existing.decision !== input.decision ||
              existing.reason !== input.reason
            )
              throw new HttpError(
                409,
                "Bộ phận của bạn đã ghi quyết định; không được sửa biên bản",
              );
            return { ...inspectionDTO(row, actor), created: false };
          }
          if (
            row.SupplyRequest.status === "CANCELLED" ||
            (row.SupplyRequest._count?.deliveries ?? 0) > 2 ||
            !["ARRIVED", "PENDING_APPROVAL"].includes(row.status) ||
            row.deliveryApprovals.some(
              (approval) => approval.decision === "REJECT",
            )
          )
            throw new HttpError(
              409,
              "Đợt giao không còn được phép kiểm tra/tiếp nhận",
            );
          if (input.decision === "APPROVE") {
            const approvedRoles = new Set(
              row.deliveryApprovals
                .filter((approval) => approval.decision === "APPROVE")
                .map((approval) => approval.Role.code),
            );
            approvedRoles.add(actor.role);
            if (
              deliveryInspectionRoles.every((role) => approvedRoles.has(role))
            ) {
              const lots = row.deliveryItems.flatMap(
                (item) => item.ingredientLots,
              );
              await inspections.lockLots(
                tx,
                lots.map((lot) => lot.id),
              );
              row = (await inspections.detail(tx, schoolId, id))!;
              assertReceipt(row, schoolId, now());
              for (const item of row.deliveryItems) {
                const previous = await inspections.receivedItems(
                  tx,
                  item.supplyRequestItemId,
                );
                const received = previous.reduce(
                  (total, value) =>
                    total.add(
                      convertQuantity(
                        value.actualQuantity,
                        value.unit,
                        item.unit,
                      ),
                    ),
                  new Prisma.Decimal(0),
                );
                const requested = convertQuantity(
                  item.SupplyRequestItem.requestedQuantity,
                  item.SupplyRequestItem.unit,
                  item.unit,
                );
                if (received.add(item.actualQuantity).gt(requested))
                  throw new HttpError(
                    409,
                    "Tổng lượng tiếp nhận vượt số lượng được yêu cầu cung ứng",
                  );
              }
              if (
                await inspections.historyCount(
                  tx,
                  lots.map((lot) => lot.id),
                )
              )
                throw new HttpError(
                  409,
                  "Lô đã có lịch sử kho; cần đối chiếu trước khi tiếp nhận",
                );
              for (const lot of row.deliveryItems.flatMap(
                (item) => item.ingredientLots,
              )) {
                if (!(await inspections.receiveLot(tx, lot, id, actor.id)))
                  throw new HttpError(
                    409,
                    "Tồn kho lô đã thay đổi; chưa tiếp nhận",
                  );
              }
              await inspections.setStatus(tx, id, "RECEIVED", actor.id, now());
            } else {
              await inspections.setStatus(
                tx,
                id,
                "PENDING_APPROVAL",
                actor.id,
                now(),
              );
            }
          } else {
            await inspections.setStatus(tx, id, "REJECTED", actor.id, now());
          }
          await inspections.decide(
            tx,
            id,
            actor.id,
            actor.roleId,
            input.decision,
            input.reason,
          );
          if (
            input.decision === "REJECT" &&
            (await inspections.rejectedCount(tx, row.supplyRequestId)) > 2
          )
            await inspections.cancelRemainder(tx, row.supplyRequestId);
          const saved = (await inspections.detail(tx, schoolId, id))!;
          return { ...inspectionDTO(saved, actor), created: true };
        },
      );
    },
    async list(query: DeliveryInspectionQueryDTO, principal: AuthPrincipal) {
      const schoolId = inspectionScope(principal);
      return databaseOperation(async () => {
        const db = await connect();
        const range = inspectionDateRange(query.period, now(), query.date);
        const [rows, counts] = await Promise.all([
          inspections.list(db, schoolId, query, range),
          inspections.counts(db, schoolId, query, range),
        ]);
        const statuses = Object.fromEntries(
          counts.map((row) => [row.status, row._count._all]),
        );
        const totalItems = counts.reduce(
          (total, row) => total + row._count._all,
          0,
        );
        return {
          items: rows.map((row) => inspectionDTO(row, principal)),
          pagination: {
            page: query.page,
            limit: query.limit,
            totalItems,
            hasNext: query.page * query.limit < totalItems,
          },
          stats: {
            total: totalItems,
            received: statuses.RECEIVED ?? 0,
            inTransit: statuses.IN_TRANSIT ?? 0,
            arrived: statuses.ARRIVED ?? 0,
            pending: statuses.PENDING_APPROVAL ?? 0,
            approved: statuses.APPROVED ?? 0,
            rejected: statuses.REJECTED ?? 0,
          },
        };
      });
    },
    async detail(
      id: string,
      principal: AuthPrincipal,
    ): Promise<DeliveryInspectionDTO> {
      const schoolId = inspectionScope(principal);
      return databaseOperation(async () => {
        const row = await inspections.detail(await connect(), schoolId, id);
        if (!row)
          throw new HttpError(404, "Không tìm thấy đợt giao trong trường");
        return {
          ...inspectionDTO(row, principal),
          deliveryItems: row.deliveryItems.map((item) => ({
            id: item.id,
            ingredientName:
              item.SupplyRequestItem.IngredientEntry.Ingredient.name,
            category:
              item.SupplyRequestItem.IngredientEntry.Ingredient
                .ingredientCategory?.categoryName ?? null,
            actualQuantity: item.actualQuantity.toString(),
            unit: item.unit,
            ingredientLots: item.ingredientLots.map((lot) => ({
              id: lot.id,
              lotCode: lot.lotCode,
              qrToken: lot.qrToken,
              sourceFacility: lot.SourceFacility?.name ?? null,
              manufactureDate:
                lot.manufactureDate?.toISOString().slice(0, 10) ?? null,
              expiryDate: lot.expiryDate?.toISOString().slice(0, 10) ?? null,
              receivedQuantity: lot.receivedQuantity.toString(),
              unit: lot.unit,
              status: lot.status,
            })),
          })),
        };
      });
    },
  };
}
export const deliveryInspectionService = createDeliveryInspectionService();
export type DeliveryInspectionService = ReturnType<
  typeof createDeliveryInspectionService
>;
