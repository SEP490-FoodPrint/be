import type { AuthPrincipal } from "../../types/auth";
import { recordPhotoUrl, type RecordPhoto } from "../../utils/record-photo";
import {
  assertPermission,
  databaseOperation,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { getDeliveryStatusLabel } from "../../utils/delivery-status";
import { ROLE_LABELS } from "../../constants/roles";
import {
  deliveryInspectionRepository as inspections,
  deliveryListSelect,
  readDeliveriesFromDatabase,
  type DeliveryInspectionDetailRow,
  type DeliveryInspectionRow,
  type DeliveryListReader,
} from "./delivery.repository";
import type {
  DeliveryArrivalBodyDTO,
  DeliveryArrivalQueryDTO,
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
import { getPrisma } from "../../utils/database";
import {
  blockchainProofService,
  type ProofRef,
} from "../blockchain-proof/blockchain-proof.service";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

export function createDeliveryService(
  read: DeliveryListReader = readDeliveriesFromDatabase,
) {
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
            select: deliveryListSelect,
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
                di.Ingredient?.name ??
                di.SupplyRequestItem?.IngredientEntry?.Ingredient?.name ??
                null,
              handlingType:
                di.IngredientEntry?.handlingType ??
                di.SupplyRequestItem?.IngredientEntry?.handlingType ??
                null,
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
  const source = row.SupplyRequest;
  const sourceType =
    row.creationMode ?? (row.supplyRequestId ? "REQUEST" : "STANDALONE");
  const rejectedCount = source?._count?.deliveries ?? 0;
  return {
    id: row.id,
    deliveryNo: row.deliveryNo,
    schoolId: row.schoolId,
    sourceType,
    traceabilityVersion: row.traceabilityVersion ?? null,
    supplyRequestId: row.supplyRequestId,
    requestNo: source?.requestNo ?? null,
    supplierName: row.Supplier.name,
    status: row.status,
    statusLabel: getDeliveryStatusLabel(row.status),
    expectedArrivalAt: row.expectedArrivalAt?.toISOString() ?? null,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    vehiclePlate: row.vehiclePlate,
    note: row.note,
    currentRole: principal.role,
    canInspect:
      principal.permissions.includes("delivery.inspect") &&
      (!source || (rejectedCount <= 2 && source.status !== "CANCELLED")) &&
      ["ARRIVED", "PENDING_APPROVAL"].includes(row.status) &&
      !row.deliveryApprovals.some(
        (approval) => approval.roleId === principal.roleId,
      ),
    redeliveryRequiredCount: source ? rejectedCount : null,
    redeliveryLimit: source ? 2 : null,
    cancellationNotice:
      source && (source.status === "CANCELLED" || rejectedCount > 2)
        ? `Đơn ${source.requestNo}${source.status === "CANCELLED" ? " đã hủy phần chưa nhận" : " bị chặn nhận tiếp"}${rejectedCount > 2 ? " do tổng số lần phải giao lại vượt quá 2" : ""}. Không tiếp nhận thêm nguyên liệu của đơn này.`
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
      photoUrl: recordPhotoUrl(approval.photoPublicId),
      decidedAt: approval.decidedAt.toISOString(),
    })),
  };
}

function inspectionDetailDTO(
  row: DeliveryInspectionDetailRow,
  principal: AuthPrincipal,
): DeliveryInspectionDTO {
  return {
    ...inspectionDTO(row, principal),
    deliveryItems: row.deliveryItems.map((item) => ({
      id: item.id,
      ingredientName:
        item.ingredientNameSnapshot ??
        item.Ingredient?.name ??
        item.SupplyRequestItem?.IngredientEntry?.Ingredient?.name ??
        "",
      category:
        item.Ingredient?.ingredientCategory?.categoryName ??
        item.SupplyRequestItem?.IngredientEntry?.Ingredient?.ingredientCategory
          ?.categoryName ??
        null,
      actualQuantity: item.actualQuantity.toString(),
      unit: item.unit,
      sourceFacility: item.sourceFacilityNameSnapshot
        ? {
            id: item.sourceFacilityId ?? null,
            name: item.sourceFacilityNameSnapshot,
            facilityCode: item.sourceFacilityCodeSnapshot ?? null,
          }
        : null,
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
    row.schoolId !== schoolId ||
    !row.deliveryItems.length ||
    (row.SupplyRequest &&
      (row.supplierId !== row.SupplyRequest.supplierId ||
        row.SupplyRequest.schoolId !== schoolId))
  )
    throw new HttpError(
      409,
      "Thông tin Supplier hoặc mặt hàng giao chưa hợp lệ",
    );
  const seenWorkflowPairs = new Set<string>();
  const today = new Date(now.getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 10);
  for (const item of row.deliveryItems) {
    if (row.workflowVersion === 2) {
      if (!item.sourceFacilityId) {
        throw new HttpError(
          409,
          "Mặt hàng giao thiếu thông tin cơ sở cung cấp",
        );
      }
      const pairKey = `${item.ingredientId}:${item.sourceFacilityId}`;
      if (seenWorkflowPairs.has(pairKey)) {
        throw new HttpError(
          409,
          "Đợt giao có cặp nguyên liệu và cơ sở cung cấp bị trùng lặp",
        );
      }
      seenWorkflowPairs.add(pairKey);
    }
    if (row.supplyRequestId !== null) {
      const sourceItem = item.SupplyRequestItem;
      if (
        !sourceItem ||
        sourceItem.supplyRequestId !== row.supplyRequestId ||
        sourceItem.IngredientEntry.schoolId !== schoolId ||
        sourceItem.IngredientEntry.Ingredient.supplierId !== row.supplierId ||
        (row.workflowVersion === 2 &&
          item.Ingredient.supplierId !== row.supplierId) ||
        !item.actualQuantity.gt(0) ||
        !item.ingredientLots.length
      )
        throw new HttpError(
          409,
          "Mặt hàng/lô giao phải khớp đơn cung ứng và trường",
        );
    } else {
      if (
        item.supplyRequestItemId !== null ||
        item.Ingredient.supplierId !== row.supplierId ||
        !item.IngredientEntry ||
        item.IngredientEntry.schoolId !== schoolId ||
        item.IngredientEntry.ingredientId !== item.ingredientId ||
        item.IngredientEntry.status !== "ACTIVE" ||
        !item.actualQuantity.gt(0) ||
        !item.ingredientLots.length
      )
        throw new HttpError(
          409,
          "Mặt hàng/lô giao phải khớp danh mục nguyên liệu của trường và nhà cung cấp",
        );
    }
    if (row.traceabilityVersion === 1 && !item.sourceFacilityId) {
      throw new HttpError(
        409,
        "Mặt hàng giao v1 thiếu thông tin cơ sở cung cấp",
      );
    }
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
      if (
        row.traceabilityVersion === 1 &&
        (!lot.sourceFacilityId ||
          lot.sourceFacilityId !== item.sourceFacilityId)
      ) {
        throw new HttpError(
          409,
          "Lô tiếp nhận phải khớp cơ sở cung cấp của mặt hàng giao",
        );
      }
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

async function verifyRequestDeliveryReceipt(
  tx: Parameters<typeof inspections.listRequestSourceItems>[0],
  row: DeliveryInspectionDetailRow,
  schoolId: string,
) {
  if (row.supplyRequestId === null) return;
  const sourceItems = await inspections.listRequestSourceItems(
    tx,
    row.supplyRequestId,
    schoolId,
    row.supplierId,
  );
  if (!sourceItems.length) {
    throw new HttpError(
      409,
      "Không tìm thấy các mặt hàng nguồn của yêu cầu cung ứng",
    );
  }
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const grouped = new Map<
    string,
    DeliveryInspectionDetailRow["deliveryItems"]
  >();
  for (const item of row.deliveryItems) {
    if (!item.supplyRequestItemId || !item.SupplyRequestItem) {
      throw new HttpError(409, "Thiếu dòng yêu cầu nguồn của phiếu giao");
    }
    const sourceItem = sourceById.get(item.supplyRequestItemId);
    if (
      !sourceItem ||
      sourceItem.IngredientEntry.schoolId !== schoolId ||
      sourceItem.IngredientEntry.Ingredient.supplierId !== row.supplierId
    ) {
      throw new HttpError(
        409,
        "Mặt hàng giao không thuộc yêu cầu cung ứng hợp lệ",
      );
    }
    const list = grouped.get(item.supplyRequestItemId);
    if (list) {
      list.push(item);
    } else {
      grouped.set(item.supplyRequestItemId, [item]);
    }
  }
  const isV2Workflow = row.workflowVersion === 2;
  if (
    isV2Workflow &&
    (grouped.size !== sourceItems.length ||
      sourceItems.some((source) => !grouped.has(source.id)))
  ) {
    throw new HttpError(
      409,
      "Đợt giao phải bao gồm đầy đủ tất cả mặt hàng trong yêu cầu cung ứng",
    );
  }
  const previousRows = await inspections.receivedItemsBySourceIds(
    tx,
    [...grouped.keys()],
    row.id,
  );
  const previousBySourceId = new Map<string, typeof previousRows>();
  for (const prev of previousRows) {
    if (!prev.supplyRequestItemId) continue;
    const list = previousBySourceId.get(prev.supplyRequestItemId);
    if (list) {
      list.push(prev);
    } else {
      previousBySourceId.set(prev.supplyRequestItemId, [prev]);
    }
  }
  for (const [sourceItemId, group] of grouped.entries()) {
    const sourceItem = sourceById.get(sourceItemId)!;
    const previousGroup = previousBySourceId.get(sourceItemId) ?? [];
    const received = previousGroup.reduce(
      (total, value) =>
        total.add(
          convertQuantity(value.actualQuantity, value.unit, sourceItem.unit),
        ),
      new Prisma.Decimal(0),
    );
    let currentGroup = new Prisma.Decimal(0);
    for (const item of group) {
      if (isV2Workflow) {
        if (
          item.ingredientId !== sourceItem.IngredientEntry.ingredientId ||
          item.ingredientEntryId !== sourceItem.ingredientEntryId ||
          item.unit !== sourceItem.unit
        ) {
          throw new HttpError(
            409,
            "Mặt hàng giao không khớp nguyên liệu, danh mục hoặc đơn vị của yêu cầu nguồn",
          );
        }
        currentGroup = currentGroup.add(item.actualQuantity);
      } else {
        currentGroup = currentGroup.add(
          convertQuantity(item.actualQuantity, item.unit, sourceItem.unit),
        );
      }
    }
    if (isV2Workflow && !currentGroup.eq(sourceItem.requestedQuantity)) {
      throw new HttpError(
        409,
        "Tổng lượng giao của từng mặt hàng phải khớp số lượng được yêu cầu cung ứng",
      );
    }
    if (received.add(currentGroup).gt(sourceItem.requestedQuantity)) {
      throw new HttpError(
        409,
        "Tổng lượng tiếp nhận vượt số lượng được yêu cầu cung ứng",
      );
    }
  }
}

export function createDeliveryInspectionService(
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
  proofs: Pick<
    typeof blockchainProofService,
    "prepareDeliveryInspected" | "scheduleAnchor"
  > = blockchainProofService,
) {
  return {
    async arrive(
      id: string,
      _body: DeliveryArrivalBodyDTO,
      _query: DeliveryArrivalQueryDTO,
      principal: AuthPrincipal,
    ): Promise<DeliveryInspectionDTO> {
      inspectionScope(principal);
      return withSchoolTransaction(
        await connect(),
        principal,
        "delivery.inspect",
        async (tx, actor, schoolId) => {
          inspectionScope(actor);
          if (!(await inspections.lock(tx, schoolId, id)))
            throw new HttpError(404, "Không tìm thấy đợt giao trong trường");
          const row = await inspections.detail(tx, schoolId, id);
          if (!row)
            throw new HttpError(404, "Không tìm thấy đợt giao trong trường");
          if (row.traceabilityVersion !== 1) {
            throw new HttpError(
              409,
              "Đợt giao lịch sử không hỗ trợ xác nhận đến trường qua luồng mới",
            );
          }
          if (
            row.status === "CANCELLED" ||
            row.status === "CANCELLED_MEAL" ||
            row.SupplyRequest?.status === "CANCELLED"
          ) {
            throw new HttpError(
              409,
              "Đợt giao hoặc yêu cầu cung ứng nguồn đã bị hủy",
            );
          }
          if (
            row.arrivedAt !== null &&
            ["ARRIVED", "PENDING_APPROVAL", "RECEIVED", "REJECTED"].includes(
              row.status,
            )
          ) {
            return inspectionDetailDTO(row, actor);
          }
          if (row.status !== "IN_TRANSIT" || row.arrivedAt !== null) {
            throw new HttpError(
              409,
              "Trạng thái đợt giao không hợp lệ để xác nhận đến trường",
            );
          }
          const updated = await inspections.markArrived(
            tx,
            id,
            schoolId,
            now(),
          );
          if (updated.count !== 1) {
            throw new HttpError(
              409,
              "Trạng thái đợt giao đã thay đổi trước khi xác nhận đến trường",
            );
          }
          const saved = (await inspections.detail(tx, schoolId, id))!;
          return inspectionDetailDTO(saved, actor);
        },
      );
    },
    async decide(
      id: string,
      input: DeliveryInspectionDecisionDTO,
      principal: AuthPrincipal,
      photo: RecordPhoto | null = null,
    ) {
      inspectionScope(principal);
      let proof: ProofRef | null = null;
      const result = await withSchoolTransaction(
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
              existing.reason !== input.reason ||
              (existing.photoHash ?? null) !== (photo?.photoHash ?? null)
            )
              throw new HttpError(
                409,
                "Bộ phận của bạn đã ghi quyết định; không được sửa biên bản",
              );
            return { ...inspectionDTO(row, actor), created: false };
          }
          if (
            row.SupplyRequest?.status === "CANCELLED" ||
            (row.SupplyRequest?._count?.deliveries ?? 0) > 2 ||
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
              if (row.supplyRequestId === null) {
                const entries = await inspections.findSchoolIngredientEntries(
                  tx,
                  schoolId,
                  row.deliveryItems.map((item) => item.ingredientId),
                );
                const entryByIngredientId = new Map(
                  entries.map((entry) => [entry.ingredientId, entry]),
                );
                let attached = false;
                for (const item of row.deliveryItems) {
                  const entry = entryByIngredientId.get(item.ingredientId);
                  if (!entry || entry.status !== "ACTIVE") {
                    throw new HttpError(
                      409,
                      "Chưa cấu hình danh mục nguyên liệu đang hoạt động của trường để tiếp nhận lô",
                    );
                  }
                  if (item.ingredientEntryId !== entry.id) {
                    await inspections.attachDeliveryItemEntry(
                      tx,
                      item.id,
                      entry.id,
                    );
                    attached = true;
                  }
                }
                if (attached) {
                  row = (await inspections.detail(tx, schoolId, id))!;
                }
              }
              assertReceipt(row, schoolId, now());
              if (row.supplyRequestId !== null) {
                await verifyRequestDeliveryReceipt(tx, row, schoolId);
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
            photo,
          );
          if (
            input.decision === "REJECT" &&
            row.supplyRequestId !== null &&
            (await inspections.rejectedCount(tx, row.supplyRequestId)) > 2
          )
            await inspections.cancelRemainder(tx, row.supplyRequestId);
          const saved = (await inspections.detail(tx, schoolId, id))!;
          proof =
            saved.status === "RECEIVED" || saved.status === "REJECTED"
              ? await proofs.prepareDeliveryInspected(tx, id, actor.id)
              : null;
          return { ...inspectionDTO(saved, actor), created: true };
        },
      );
      proofs.scheduleAnchor(proof);
      return result;
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
        return inspectionDetailDTO(row, principal);
      });
    },
  };
}
export const deliveryInspectionService = createDeliveryInspectionService();
export type DeliveryInspectionService = ReturnType<
  typeof createDeliveryInspectionService
>;
