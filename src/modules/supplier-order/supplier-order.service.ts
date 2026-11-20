import { createHash, randomUUID } from "node:crypto";
import { readPublicTraceOrigin } from "../../config/env";
import { Prisma } from "../../generated/prisma/client";
import {
  blockchainProofService,
  type BlockchainProofService,
  type ProofRef,
} from "../blockchain-proof/blockchain-proof.service";
import type { AuthPrincipal } from "../../types/auth";
import { databaseOperation, loadPrincipal } from "../../utils/authorization";
import {
  getDeliveryStatusLabel,
  resolveSupplierDeliveryNextAction,
} from "../../utils/delivery-status";
import { HttpError } from "../../utils/http-error";
import { listWindow, readListPage } from "../../utils/list-query";
import {
  buildDeliveryTraceUrl,
  generateDeliveryQrToken,
  renderDeliveryQrBatch,
} from "../../utils/qr-code";
import {
  hasSupplierOrderManagePermission,
  hasSupplierOrderReadPermission,
  supplierOrderLabelScope,
  supplierOrderManagementScope,
  supplierOrderReadScope,
  supplierOrderSourceOptionScope,
} from "../../utils/resource-access";
import { createIntakeAccessService } from "../account-lifecycle/intake-access.service";
import {
  supplierOrderRepository,
  type SupplierOrderDb,
  type SupplierOrderDetailRecord,
  type SupplierOrderIngredientOptionRecord,
  type SupplierOrderRepository,
  type SupplierOrderSchoolOptionRecord,
  type SupplierOrderSourceFacilityOptionRecord,
  type SupplierOrderSummaryRecord,
} from "./supplier-order.repository";
import type {
  CreateFromRequestBodyDTO,
  CreateStandaloneBodyDTO,
  CreateSupplierOrderBodyDTO,
  CreateSupplierOrderRequestDTO,
  DispatchSupplierOrderBodyDTO,
  SupplierOrderDetailParamsDTO,
  SupplierOrderLabelsQueryDTO,
  SupplierOrderListQueryDTO,
  SupplierOrderOptionsQueryDTO,
  SupplierSchoolOptionsQueryDTO,
} from "./supplier-order.request.dto";
import type {
  DeliveryLabelListResponseDTO,
  SupplierIngredientOptionDTO,
  SupplierIngredientOptionListResponseDTO,
  SupplierOrderCreateResultDTO,
  SupplierOrderDetailDTO,
  SupplierOrderItemDTO,
  SupplierOrderListResponseDTO,
  SupplierOrderSourceType,
  SupplierOrderSummaryDTO,
  SupplierSchoolOptionDTO,
  SupplierSchoolOptionListResponseDTO,
  SupplierSourceFacilityOptionDTO,
  SupplierSourceFacilityOptionListResponseDTO,
} from "./supplier-order.response.dto";

type Dependencies = {
  /** Anchors the dispatch declaration (UC-50, UC-51) after commit. */
  proofs?: Pick<
    BlockchainProofService,
    "prepareDeliveryDeclared" | "scheduleAnchor"
  >;
  transaction?: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  /** Current time source; injectable so tests can pin "now" for dispatch ETA checks. */
  now?: () => Date;
  guard?: Pick<ReturnType<typeof createIntakeAccessService>, "assertAccess"> &
    Partial<
      Pick<
        ReturnType<typeof createIntakeAccessService>,
        "assertDeliveryContinuation"
      >
    >;
  verifyActor?: (
    db: SupplierOrderDb,
    principal: AuthPrincipal,
  ) => Promise<AuthPrincipal>;
  publicTraceOrigin?: string;
  readOrigin?: () => string;
  generateToken?: () => string;
  renderQrBatch?: (urls: readonly string[]) => Promise<string[]>;
};

interface PreparedQrCandidate {
  qrToken: string;
  qrUrl: string;
}

function resolveSourceType(
  creationMode: "REQUEST" | "STANDALONE" | null,
  supplyRequestId: string | null,
): SupplierOrderSourceType {
  if (creationMode === "STANDALONE") return "STANDALONE";
  if (creationMode === "REQUEST") return "REQUEST";
  return supplyRequestId ? "REQUEST" : "STANDALONE";
}

function mapSupplierOrderItem(
  item: SupplierOrderDetailRecord["deliveryItems"][number],
): SupplierOrderItemDTO {
  return {
    id: item.id,
    ingredientId: item.ingredientId,
    ingredientName: item.ingredientNameSnapshot ?? item.Ingredient.name,
    ingredientEntryId: item.ingredientEntryId,
    supplyRequestItemId: item.supplyRequestItemId,
    sourceFacility:
      item.sourceFacilityId !== null && item.sourceFacilityNameSnapshot !== null
        ? {
            id: item.sourceFacilityId,
            name: item.sourceFacilityNameSnapshot,
            facilityCode: item.sourceFacilityCodeSnapshot,
          }
        : null,
    traceUrl: item.qrUrl ?? null,
    actualQuantity: item.actualQuantity.toString(),
    unit: item.unit,
    note: item.note,
  };
}

function mapSupplierOrderSummary(
  row: SupplierOrderSummaryRecord,
  principal: AuthPrincipal,
): SupplierOrderSummaryDTO {
  return {
    id: row.id,
    deliveryNo: row.deliveryNo,
    sourceType: resolveSourceType(row.creationMode, row.supplyRequestId),
    traceabilityVersion: row.traceabilityVersion,
    workflowVersion: row.workflowVersion,
    nextAction: resolveSupplierDeliveryNextAction({
      workflowVersion: row.workflowVersion,
      status: row.status,
      supplyRequestStatus: row.SupplyRequest?.status ?? null,
      canManage: hasSupplierOrderManagePermission(principal),
      canRead: hasSupplierOrderReadPermission(principal),
    }),
    schoolId: row.schoolId,
    schoolName: row.School.name,
    supplierId: row.supplierId,
    supplyRequestId: row.supplyRequestId,
    requestNo: row.SupplyRequest?.requestNo ?? null,
    status: row.status,
    statusLabel: getDeliveryStatusLabel(row.status),
    expectedArrivalAt: row.expectedArrivalAt?.toISOString() ?? null,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    vehiclePlate: row.vehiclePlate,
    note: row.note,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSupplierOrderDetail(
  row: SupplierOrderDetailRecord,
  principal: AuthPrincipal,
): SupplierOrderDetailDTO {
  return {
    ...mapSupplierOrderSummary(row, principal),
    items: row.deliveryItems.map(mapSupplierOrderItem),
  };
}

function mapSchoolOption(
  school: SupplierOrderSchoolOptionRecord,
): SupplierSchoolOptionDTO {
  return {
    id: school.id,
    code: school.code,
    name: school.name,
  };
}

function mapIngredientOption(
  ingredient: SupplierOrderIngredientOptionRecord,
): SupplierIngredientOptionDTO {
  return {
    id: ingredient.id,
    name: ingredient.name,
    defaultUnit: ingredient.defaultUnit,
    categoryId: ingredient.categoryId,
    categoryName: ingredient.ingredientCategory?.categoryName ?? null,
  };
}

function mapSourceFacilityOption(
  facility: SupplierOrderSourceFacilityOptionRecord,
): SupplierSourceFacilityOptionDTO {
  return {
    id: facility.id,
    facilityCode: facility.facilityCode,
    name: facility.name,
  };
}

function canonicalDecimalString(value: string): string {
  return new Prisma.Decimal(value).toString();
}

function canonicalizeCreateBody(
  body: CreateSupplierOrderBodyDTO,
): CreateSupplierOrderBodyDTO {
  if (body.sourceType === "REQUEST") {
    return {
      ...body,
      sources: [...body.sources]
        .map((source) => ({
          ...source,
          actualQuantity: canonicalDecimalString(source.actualQuantity),
        }))
        .sort(
          (a, b) =>
            a.supplyRequestItemId.localeCompare(b.supplyRequestItemId) ||
            a.sourceFacilityId.localeCompare(b.sourceFacilityId),
        ),
    };
  }
  return {
    ...body,
    items: [...body.items]
      .map((item) => ({
        ...item,
        actualQuantity: canonicalDecimalString(item.actualQuantity),
      }))
      .sort(
        (a, b) =>
          a.ingredientId.localeCompare(b.ingredientId) ||
          a.sourceFacilityId.localeCompare(b.sourceFacilityId),
      ),
  };
}

function lotDatesFingerprint(line: {
  manufactureDate?: string | null;
  expiryDate?: string | null;
}) {
  return {
    ...(line.manufactureDate ? { manufactureDate: line.manufactureDate } : {}),
    ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
  };
}

/**
 * Ngày của lô khi NCC tạo chuyến giao: đồ khô (DRY_STOCK) bắt buộc có ngày sản xuất và hạn dùng;
 * ngày sản xuất không được sau hôm nay (giờ VN). Đồ tươi không bắt buộc.
 */
function assertLotDates(
  lines: {
    name: string;
    handlingType: string | null;
    manufactureDate?: string | null;
    expiryDate?: string | null;
  }[],
) {
  const missing = lines
    .filter(
      (line) =>
        line.handlingType === "DRY_STOCK" &&
        (!line.manufactureDate || !line.expiryDate),
    )
    .map((line) => line.name);
  if (missing.length)
    throw new HttpError(
      422,
      `Đồ khô cần nhập ngày sản xuất và hạn sử dụng của lô: ${[...new Set(missing)].join(", ")}`,
    );
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const future = lines
    .filter((line) => line.manufactureDate && line.manufactureDate > today)
    .map((line) => line.name);
  if (future.length)
    throw new HttpError(
      422,
      `Ngày sản xuất không được sau hôm nay: ${[...new Set(future)].join(", ")}`,
    );
}

const lotDate = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;

function buildCreationFingerprint(body: CreateSupplierOrderBodyDTO): string {
  const payload =
    body.sourceType === "REQUEST"
      ? {
          version: 3,
          mode: body.sourceType,
          note: body.note,
          supplyRequestId: body.supplyRequestId,
          sources: body.sources.map((source) => ({
            supplyRequestItemId: source.supplyRequestItemId,
            sourceFacilityId: source.sourceFacilityId,
            actualQuantity: canonicalDecimalString(source.actualQuantity),
            ...lotDatesFingerprint(source),
          })),
        }
      : {
          version: 3,
          mode: body.sourceType,
          note: body.note,
          schoolId: body.schoolId,
          items: body.items.map((item) => ({
            ingredientId: item.ingredientId,
            sourceFacilityId: item.sourceFacilityId,
            actualQuantity: canonicalDecimalString(item.actualQuantity),
            unit: item.unit,
            ...lotDatesFingerprint(item),
          })),
        };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildCreateReplayResult(
  existing: SupplierOrderDetailRecord,
  actor: AuthPrincipal,
  fingerprint: string,
): SupplierOrderCreateResultDTO {
  if (existing.workflowVersion === null) {
    throw new HttpError(
      409,
      "Idempotency-Key đã thuộc phiên bản đơn giao hàng cũ và không thể nâng cấp",
    );
  }
  if (existing.creationFingerprint !== fingerprint) {
    throw new HttpError(
      409,
      "Idempotency-Key đã được sử dụng cho nội dung đơn giao khác",
    );
  }
  return { ...mapSupplierOrderDetail(existing, actor), created: false };
}

function getPrismaPgCause(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") return null;
  if ("meta" in error && error.meta && typeof error.meta === "object") {
    const adapterError = (error.meta as { driverAdapterError?: unknown })
      .driverAdapterError;
    if (
      adapterError &&
      typeof adapterError === "object" &&
      "cause" in adapterError &&
      adapterError.cause &&
      typeof adapterError.cause === "object"
    ) {
      return adapterError.cause as Record<string, unknown>;
    }
  }
  if ("cause" in error && error.cause && typeof error.cause === "object") {
    return error.cause as Record<string, unknown>;
  }
  return null;
}

function getUniqueConstraintName(error: unknown): string | null {
  const cause = getPrismaPgCause(error);
  if (typeof cause?.constraint === "string") return cause.constraint;
  if (
    error &&
    typeof error === "object" &&
    "meta" in error &&
    error.meta &&
    typeof error.meta === "object" &&
    Array.isArray((error.meta as { target?: unknown }).target)
  ) {
    return (error.meta as { target: string[] }).target.join("_");
  }
  return null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return true;
  }
  const cause = getPrismaPgCause(error);
  return cause?.originalCode === "23505" || cause?.code === "23505";
}

function isTransientLockError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }
  const cause = getPrismaPgCause(error);
  const code = cause?.originalCode ?? cause?.code;
  return code === "40001" || code === "40P01";
}

export function createSupplierOrderService(
  repository: SupplierOrderRepository = supplierOrderRepository,
  dependencies?: Dependencies,
) {
  const transaction =
    dependencies?.transaction ??
    (async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => {
      const db = await databaseOperation(() => repository.connect());
      for (let attempt = 0; ; attempt++) {
        try {
          return await db.$transaction(fn, {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 20_000,
            timeout: 30_000,
          });
        } catch (error) {
          if (error instanceof HttpError || isUniqueConstraintError(error)) {
            throw error;
          }
          if (attempt < 2 && isTransientLockError(error)) {
            continue;
          }
          console.error("Database operation failed");
          throw new HttpError(
            503,
            "Không thể hoàn tất tạo đơn giao hàng. Vui lòng thử lại sau.",
          );
        }
      }
    });
  const proofs = dependencies?.proofs ?? blockchainProofService;
  const now = dependencies?.now ?? (() => new Date());
  const guard = dependencies?.guard ?? createIntakeAccessService();
  const fallbackGuard = dependencies?.guard?.assertDeliveryContinuation
    ? null
    : createIntakeAccessService();
  const assertDeliveryContinuation = (
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    command: Parameters<
      ReturnType<typeof createIntakeAccessService>["assertDeliveryContinuation"]
    >[2],
  ) =>
    guard.assertDeliveryContinuation
      ? guard.assertDeliveryContinuation(tx, principal, command)
      : fallbackGuard!.assertDeliveryContinuation(tx, principal, command);
  const verifyActor =
    dependencies?.verifyActor ??
    (async (db: SupplierOrderDb, principal: AuthPrincipal) => {
      const liveActor = await loadPrincipal(principal.id, db);
      if (
        !liveActor ||
        liveActor.id !== principal.id ||
        liveActor.orgType !== principal.orgType ||
        liveActor.supplierId !== principal.supplierId ||
        liveActor.role !== principal.role ||
        liveActor.roleId !== principal.roleId ||
        liveActor.schoolId !== principal.schoolId ||
        liveActor.communeFoodSafetyUnitId !== principal.communeFoodSafetyUnitId
      ) {
        throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
      }
      supplierOrderManagementScope(liveActor);
      return liveActor;
    });
  const resolveOrigin = () =>
    dependencies?.readOrigin
      ? dependencies.readOrigin()
      : (dependencies?.publicTraceOrigin ?? readPublicTraceOrigin());
  const generateToken = dependencies?.generateToken ?? generateDeliveryQrToken;
  const renderQrBatch =
    dependencies?.renderQrBatch ??
    ((urls: readonly string[]) => renderDeliveryQrBatch(urls));

  async function prepareQrCandidates(
    count: number,
  ): Promise<PreparedQrCandidate[]> {
    if (count <= 0) return [];
    const origin = resolveOrigin();
    const candidates = Array.from({ length: count }, () => {
      const qrToken = generateToken();
      return {
        qrToken,
        qrUrl: buildDeliveryTraceUrl(origin, qrToken),
      };
    });
    try {
      await renderQrBatch(candidates.map((candidate) => candidate.qrUrl));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "Không thể tạo ảnh mã QR cho đơn giao hàng. Vui lòng thử lại sau.",
      );
    }
    return candidates;
  }

  async function resolveAndValidateSourceFacilities(
    tx: Prisma.TransactionClient,
    supplierId: string,
    sourceFacilityIds: readonly string[],
  ) {
    const uniqueFacilityIds = [...new Set(sourceFacilityIds)];
    await repository.lockSourceFacilities(tx, supplierId, uniqueFacilityIds);
    const facilities = await repository.findSourceFacilitiesByIds(
      tx,
      uniqueFacilityIds,
    );
    const facilityById = new Map(
      facilities.map((facility) => [facility.id, facility]),
    );
    for (const sourceFacilityId of sourceFacilityIds) {
      const facility = facilityById.get(sourceFacilityId);
      if (!facility || facility.supplierId !== supplierId) {
        throw new HttpError(
          404,
          "Không tìm thấy cơ sở cung cấp thuộc nhà cung cấp",
        );
      }
      if (facility.status !== "ACTIVE") {
        throw new HttpError(409, "Cơ sở cung cấp đang ngừng hoạt động");
      }
    }
    return facilityById;
  }

  function reserveNextDeliveryNo(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return repository.allocateDeliveryNo(tx);
  }

  async function createFromRequest(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    idempotencyKey: string,
    fingerprint: string,
    body: CreateFromRequestBodyDTO,
    candidates: readonly PreparedQrCandidate[],
  ): Promise<SupplierOrderCreateResultDTO> {
    const sourceFacilityIds = body.sources.map(
      (source) => source.sourceFacilityId,
    );
    const actor = await guard.assertAccess(tx, principal, {
      operation: "START_ORDER_PROCESSING",
      orderId: body.supplyRequestId,
      requiredPermission: "delivery.manage",
      sourceFacilityIds,
    });
    const liveScope = supplierOrderManagementScope(actor);

    const requestRow = await repository.findSupplyRequestForCreation(
      tx,
      body.supplyRequestId,
    );
    if (!requestRow || requestRow.supplierId !== liveScope.supplierId) {
      throw new HttpError(
        404,
        "Không tìm thấy yêu cầu cung ứng thuộc nhà cung cấp",
      );
    }
    if (
      requestRow.status !== "ACCEPTED" &&
      requestRow.status !== "IN_PROGRESS"
    ) {
      throw new HttpError(
        409,
        "Trạng thái yêu cầu cung ứng không hợp lệ để tạo đơn giao",
      );
    }
    if (await repository.hasDeliveryForRequest(tx, requestRow.id)) {
      throw new HttpError(409, "Yêu cầu cung ứng này đã có đợt giao");
    }
    if (requestRow.supplyRequestItems.length === 0) {
      throw new HttpError(
        409,
        "Yêu cầu cung ứng không có dòng nguyên liệu nào",
      );
    }

    const requestItemById = new Map(
      requestRow.supplyRequestItems.map((item) => [item.id, item]),
    );
    const groupedByRequestItem = new Map<
      string,
      CreateFromRequestBodyDTO["sources"]
    >();
    const seenIngredientFacilityPairs = new Set<string>();
    for (const allocation of body.sources) {
      const requestItem = requestItemById.get(allocation.supplyRequestItemId);
      if (!requestItem) {
        throw new HttpError(
          409,
          "Danh sách nguồn cung ứng phải khớp chính xác toàn bộ dòng của yêu cầu cung ứng",
        );
      }
      const group = groupedByRequestItem.get(requestItem.id) ?? [];
      group.push(allocation);
      groupedByRequestItem.set(requestItem.id, group);

      const ingredientFacilityKey = `${requestItem.IngredientEntry.ingredientId}:${allocation.sourceFacilityId}`;
      if (seenIngredientFacilityPairs.has(ingredientFacilityKey)) {
        throw new HttpError(
          409,
          "Không thể phân bổ trùng cặp nguyên liệu và cơ sở cung cấp trong cùng đơn giao",
        );
      }
      seenIngredientFacilityPairs.add(ingredientFacilityKey);
    }

    if (
      groupedByRequestItem.size !== requestRow.supplyRequestItems.length ||
      requestRow.supplyRequestItems.some(
        (item) => !groupedByRequestItem.has(item.id),
      )
    ) {
      throw new HttpError(
        409,
        "Danh sách nguồn cung ứng phải khớp chính xác toàn bộ dòng của yêu cầu cung ứng",
      );
    }

    for (const requestItem of requestRow.supplyRequestItems) {
      const allocations = groupedByRequestItem.get(requestItem.id)!;
      const totalAllocated = allocations.reduce(
        (sum, allocation) =>
          sum.add(new Prisma.Decimal(allocation.actualQuantity)),
        new Prisma.Decimal(0),
      );
      if (!totalAllocated.eq(requestItem.requestedQuantity)) {
        throw new HttpError(
          409,
          "Tổng số lượng phân bổ theo từng dòng yêu cầu phải bằng đúng số lượng yêu cầu",
        );
      }
    }

    assertLotDates(
      body.sources.map((allocation) => {
        const requestItem = requestItemById.get(
          allocation.supplyRequestItemId,
        )!;
        return {
          name: requestItem.IngredientEntry.Ingredient.name,
          handlingType: requestItem.IngredientEntry.handlingType,
          manufactureDate: allocation.manufactureDate,
          expiryDate: allocation.expiryDate,
        };
      }),
    );
    const facilityById = await resolveAndValidateSourceFacilities(
      tx,
      liveScope.supplierId,
      sourceFacilityIds,
    );
    const deliveryNo = await reserveNextDeliveryNo(tx);

    const created = await repository.createDeliveryWithItems(tx, {
      deliveryNo,
      creationMode: "REQUEST",
      creationKey: idempotencyKey,
      creationFingerprint: fingerprint,
      traceabilityVersion: 1,
      workflowVersion: 2,
      schoolId: requestRow.schoolId,
      supplierId: liveScope.supplierId,
      supplyRequestId: requestRow.id,
      createdByUserId: actor.id,
      expectedArrivalAt: null,
      vehiclePlate: null,
      note: body.note,
      status: "PREPARING",
      items: body.sources.map((allocation, idx) => {
        const requestItem = requestItemById.get(
          allocation.supplyRequestItemId,
        )!;
        const facility = facilityById.get(allocation.sourceFacilityId)!;
        const candidate = candidates[idx];
        return {
          id: randomUUID(),
          supplyRequestItemId: requestItem.id,
          ingredientId: requestItem.IngredientEntry.ingredientId,
          ingredientEntryId: requestItem.ingredientEntryId,
          sourceFacilityId: facility.id,
          sourceFacilityNameSnapshot: facility.name,
          sourceFacilityCodeSnapshot: facility.facilityCode,
          ingredientNameSnapshot: requestItem.IngredientEntry.Ingredient.name,
          qrToken: candidate.qrToken,
          qrUrl: candidate.qrUrl,
          actualQuantity: new Prisma.Decimal(allocation.actualQuantity),
          unit: requestItem.unit,
          note: requestItem.note,
          manufactureDate: lotDate(allocation.manufactureDate),
          expiryDate: lotDate(allocation.expiryDate),
        };
      }),
    });

    if (requestRow.status === "ACCEPTED") {
      const updatedCount = await repository.markSupplyRequestInProgress(
        tx,
        requestRow.id,
      );
      if (updatedCount !== 1) {
        throw new HttpError(
          409,
          "Trạng thái yêu cầu cung ứng đã thay đổi trước khi hoàn tất",
        );
      }
    }

    return { ...mapSupplierOrderDetail(created, actor), created: true };
  }

  async function createStandalone(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    idempotencyKey: string,
    fingerprint: string,
    body: CreateStandaloneBodyDTO,
    candidates: readonly PreparedQrCandidate[],
  ): Promise<SupplierOrderCreateResultDTO> {
    const ingredientIds = [
      ...new Set(body.items.map((item) => item.ingredientId)),
    ];
    const sourceFacilityIds = body.items.map((item) => item.sourceFacilityId);
    const actor = await guard.assertAccess(tx, principal, {
      operation: "SUPPLIER_CREATE_STANDALONE_DELIVERY",
      schoolId: body.schoolId,
      ingredientIds,
      sourceFacilityIds,
    });
    const liveScope = supplierOrderManagementScope(actor);

    const seenPairs = new Set<string>();
    for (const item of body.items) {
      const pairKey = `${item.ingredientId}:${item.sourceFacilityId}`;
      if (seenPairs.has(pairKey)) {
        throw new HttpError(
          409,
          "Không thể phân bổ trùng cặp nguyên liệu và cơ sở cung cấp trong cùng đơn giao",
        );
      }
      seenPairs.add(pairKey);
    }

    const ingredients = await repository.findIngredientsByIds(
      tx,
      ingredientIds,
    );
    const ingredientById = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient]),
    );
    for (const item of body.items) {
      const ingredient = ingredientById.get(item.ingredientId);
      if (!ingredient || ingredient.supplierId !== liveScope.supplierId) {
        throw new HttpError(
          404,
          "Không tìm thấy nguyên liệu thuộc nhà cung cấp",
        );
      }
      if (ingredient.status !== "ACTIVE") {
        throw new HttpError(409, "Nguyên liệu đang ngừng hoạt động");
      }
      if (item.unit !== ingredient.defaultUnit) {
        throw new HttpError(
          409,
          "Đơn vị tính phải khớp đơn vị mặc định của nguyên liệu",
        );
      }
    }

    const facilityById = await resolveAndValidateSourceFacilities(
      tx,
      liveScope.supplierId,
      sourceFacilityIds,
    );

    const activeEntries = await repository.findIngredientEntriesForSchool(
      tx,
      body.schoolId,
      ingredientIds,
    );
    const entryByIngredientId = new Map(
      activeEntries.map((entry) => [entry.ingredientId, entry.id]),
    );
    const handlingByIngredientId = new Map(
      activeEntries.map((entry) => [entry.ingredientId, entry.handlingType]),
    );
    assertLotDates(
      body.items.map((item) => ({
        name: ingredientById.get(item.ingredientId)!.name,
        handlingType: handlingByIngredientId.get(item.ingredientId) ?? null,
        manufactureDate: item.manufactureDate,
        expiryDate: item.expiryDate,
      })),
    );
    const deliveryNo = await reserveNextDeliveryNo(tx);

    const created = await repository.createDeliveryWithItems(tx, {
      deliveryNo,
      creationMode: "STANDALONE",
      creationKey: idempotencyKey,
      creationFingerprint: fingerprint,
      traceabilityVersion: 1,
      workflowVersion: 2,
      schoolId: body.schoolId,
      supplierId: liveScope.supplierId,
      supplyRequestId: null,
      createdByUserId: actor.id,
      expectedArrivalAt: null,
      vehiclePlate: null,
      note: body.note,
      status: "PREPARING",
      items: body.items.map((item, idx) => {
        const ingredient = ingredientById.get(item.ingredientId)!;
        const facility = facilityById.get(item.sourceFacilityId)!;
        const candidate = candidates[idx];
        return {
          id: randomUUID(),
          supplyRequestItemId: null,
          ingredientId: item.ingredientId,
          ingredientEntryId: entryByIngredientId.get(item.ingredientId) ?? null,
          sourceFacilityId: facility.id,
          sourceFacilityNameSnapshot: facility.name,
          sourceFacilityCodeSnapshot: facility.facilityCode,
          ingredientNameSnapshot: ingredient.name,
          qrToken: candidate.qrToken,
          qrUrl: candidate.qrUrl,
          actualQuantity: new Prisma.Decimal(item.actualQuantity),
          unit: item.unit,
          note: null,
          manufactureDate: lotDate(item.manufactureDate),
          expiryDate: lotDate(item.expiryDate),
        };
      }),
    });

    return { ...mapSupplierOrderDetail(created, actor), created: true };
  }

  return {
    async create(
      input: CreateSupplierOrderRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierOrderCreateResultDTO> {
      const scope = supplierOrderManagementScope(principal);
      const canonicalBody = canonicalizeCreateBody(input.body);
      const fingerprint = buildCreationFingerprint(canonicalBody);

      const db = await databaseOperation(() => repository.connect());
      const liveActor = await verifyActor(db, principal);
      const preExisting = await databaseOperation(() =>
        repository.findByCreationKey(
          db,
          scope.supplierId,
          liveActor.id,
          input.idempotencyKey,
        ),
      );
      if (preExisting) {
        return buildCreateReplayResult(preExisting, liveActor, fingerprint);
      }

      const candidates = await prepareQrCandidates(
        canonicalBody.sourceType === "REQUEST"
          ? canonicalBody.sources.length
          : canonicalBody.items.length,
      );

      try {
        return await transaction(async (tx) => {
          const existing = await repository.findByCreationKey(
            tx,
            scope.supplierId,
            liveActor.id,
            input.idempotencyKey,
          );
          if (existing) {
            const actorInTx = await verifyActor(tx, principal);
            return buildCreateReplayResult(existing, actorInTx, fingerprint);
          }

          if (canonicalBody.sourceType === "REQUEST") {
            return createFromRequest(
              tx,
              principal,
              input.idempotencyKey,
              fingerprint,
              canonicalBody,
              candidates,
            );
          }

          return createStandalone(
            tx,
            principal,
            input.idempotencyKey,
            fingerprint,
            canonicalBody,
            candidates,
          );
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const resolved = await databaseOperation(async () => {
          const catchDb = await repository.connect();
          const actorInCatch = await verifyActor(catchDb, principal);
          const replay = await repository.findByCreationKey(
            catchDb,
            scope.supplierId,
            actorInCatch.id,
            input.idempotencyKey,
          );
          return replay ? { replay, actorInCatch } : null;
        });
        if (resolved) {
          return buildCreateReplayResult(
            resolved.replay,
            resolved.actorInCatch,
            fingerprint,
          );
        }
        const constraint = getUniqueConstraintName(error);
        if (
          constraint === "uq_deliveries_request_mode" ||
          (canonicalBody.sourceType === "REQUEST" && !constraint)
        ) {
          throw new HttpError(409, "Yêu cầu cung ứng này đã có đợt giao");
        }
        throw new HttpError(
          503,
          "Không thể hoàn tất tạo đơn giao hàng do xung đột đồng thời. Vui lòng thử lại sau.",
        );
      }
    },

    async listSchoolOptions(
      query: SupplierSchoolOptionsQueryDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierSchoolOptionListResponseDTO> {
      const scope = supplierOrderManagementScope(principal);
      const db = await databaseOperation(() => repository.connect());
      const window = listWindow(query);
      const page = await readListPage(
        () =>
          repository.listSchoolOptions(db, {
            supplierId: scope.supplierId,
            skip: window.skip,
            take: window.take,
            ...(query.search ? { search: query.search } : {}),
          }),
        query,
      );
      return {
        items: page.items.map(mapSchoolOption),
        pagination: page.pagination,
      };
    },

    async listIngredientOptions(
      query: SupplierOrderOptionsQueryDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierIngredientOptionListResponseDTO> {
      const scope = supplierOrderManagementScope(principal);
      const db = await databaseOperation(() => repository.connect());
      const window = listWindow(query);
      const page = await readListPage(
        () =>
          repository.listIngredientOptions(db, {
            supplierId: scope.supplierId,
            skip: window.skip,
            take: window.take,
          }),
        query,
      );
      return {
        items: page.items.map(mapIngredientOption),
        pagination: page.pagination,
      };
    },

    async listSourceFacilityOptions(
      query: SupplierOrderOptionsQueryDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierSourceFacilityOptionListResponseDTO> {
      const scope = supplierOrderSourceOptionScope(principal);
      const db = await databaseOperation(() => repository.connect());
      const window = listWindow(query);
      const page = await readListPage(
        () =>
          repository.listSourceFacilityOptions(db, {
            scope,
            skip: window.skip,
            take: window.take,
          }),
        query,
      );
      return {
        items: page.items.map(mapSourceFacilityOption),
        pagination: page.pagination,
      };
    },

    async listLabels(
      params: SupplierOrderDetailParamsDTO,
      query: SupplierOrderLabelsQueryDTO,
      principal: AuthPrincipal,
    ): Promise<DeliveryLabelListResponseDTO> {
      const scope = supplierOrderLabelScope(principal);
      const db = await databaseOperation(() => repository.connect());
      const delivery = await databaseOperation(() =>
        repository.findDeliveryForLabels(db, scope, params.id),
      );
      if (!delivery) {
        throw new HttpError(
          404,
          "Không tìm thấy đơn giao hàng thuộc nhà cung cấp",
        );
      }
      if (delivery.traceabilityVersion !== 1) {
        throw new HttpError(409, "Đơn lịch sử chưa có nhãn QR theo dòng");
      }

      const window = listWindow(query);
      const page = await readListPage(
        () =>
          repository.listDeliveryLabelItems(db, {
            deliveryId: delivery.id,
            skip: window.skip,
            take: window.take,
          }),
        query,
      );

      for (const item of page.items) {
        if (!item.qrUrl || !item.sourceFacilityNameSnapshot) {
          throw new HttpError(409, "Đơn lịch sử chưa có nhãn QR theo dòng");
        }
      }

      const traceUrls = page.items.map((item) => item.qrUrl as string);
      let qrImages: string[];
      try {
        qrImages = traceUrls.length > 0 ? await renderQrBatch(traceUrls) : [];
      } catch {
        throw new HttpError(503, "Không thể tạo ảnh mã QR cho nhãn giao hàng");
      }
      if (qrImages.length !== page.items.length) {
        throw new HttpError(503, "Không thể tạo ảnh mã QR cho nhãn giao hàng");
      }

      return {
        items: page.items.map((item, idx) => ({
          deliveryItemId: item.id,
          deliveryNo: delivery.deliveryNo,
          supplierName: delivery.Supplier.name,
          ingredientName: item.ingredientNameSnapshot ?? item.Ingredient.name,
          actualQuantity: item.actualQuantity.toString(),
          unit: item.unit,
          sourceFacility: {
            name: item.sourceFacilityNameSnapshot!,
            facilityCode: item.sourceFacilityCodeSnapshot,
          },
          traceUrl: item.qrUrl!,
          qrImageDataUrl: qrImages[idx],
        })),
        pagination: page.pagination,
      };
    },

    async list(
      query: SupplierOrderListQueryDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierOrderListResponseDTO> {
      const scope = supplierOrderReadScope(principal);
      const db = await databaseOperation(() => repository.connect());
      const window = listWindow(query);
      const page = await readListPage(
        () =>
          repository.listManagementDeliveries(db, {
            scope,
            skip: window.skip,
            take: window.take,
            sourceType: query.sourceType,
            status: query.status,
          }),
        query,
      );
      return {
        items: page.items.map((row) => mapSupplierOrderSummary(row, principal)),
        pagination: page.pagination,
      };
    },

    async detail(
      params: SupplierOrderDetailParamsDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierOrderDetailDTO> {
      const scope = supplierOrderReadScope(principal);
      const row = await databaseOperation(async () =>
        repository.findManagementDeliveryById(
          await repository.connect(),
          scope,
          params.id,
        ),
      );
      if (!row) {
        throw new HttpError(
          404,
          "Không tìm thấy đơn giao hàng thuộc nhà cung cấp",
        );
      }
      return mapSupplierOrderDetail(row, principal);
    },

    async dispatch(
      params: SupplierOrderDetailParamsDTO,
      body: DispatchSupplierOrderBodyDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierOrderDetailDTO> {
      supplierOrderManagementScope(principal);
      const expectedArrivalAt = new Date(body.expectedArrivalAt);

      const matchesMetadata = (
        currentExpectedArrival: Date | null,
        currentPlate: string | null,
      ) =>
        currentExpectedArrival !== null &&
        currentPlate !== null &&
        currentExpectedArrival.getTime() === expectedArrivalAt.getTime() &&
        currentPlate === body.vehiclePlate;

      let proof: ProofRef | null = null;
      const result = await transaction(async (tx) => {
        proof = null;
        const continuation = await assertDeliveryContinuation(tx, principal, {
          deliveryId: params.id,
          requiredPermission: "delivery.manage",
          isReplay: (delivery) =>
            delivery.workflowVersion === 2 &&
            delivery.status !== "PREPARING" &&
            delivery.expectedArrivalAt !== null &&
            delivery.vehiclePlate !== null,
        });
        const liveScope = supplierOrderManagementScope(continuation.actor);

        if (continuation.replayed) {
          if (
            !matchesMetadata(
              continuation.delivery.expectedArrivalAt,
              continuation.delivery.vehiclePlate,
            )
          ) {
            throw new HttpError(
              409,
              "Đơn giao hàng đã được bắt đầu giao với thông tin vận chuyển khác",
            );
          }
          const existing = await repository.findManagementDeliveryById(
            tx,
            liveScope,
            params.id,
          );
          if (!existing) {
            throw new HttpError(
              404,
              "Không tìm thấy đơn giao hàng thuộc nhà cung cấp",
            );
          }
          return mapSupplierOrderDetail(existing, continuation.actor);
        }

        if (
          continuation.delivery.workflowVersion !== 2 ||
          continuation.delivery.traceabilityVersion !== 1
        ) {
          throw new HttpError(
            409,
            "Đơn giao hàng thuộc phiên bản cũ không thể cập nhật xuất kho hai bước",
          );
        }
        if (continuation.delivery.status === "CANCELLED") {
          throw new HttpError(
            409,
            "Đơn giao hàng đã bị hủy trước khi bắt đầu giao",
          );
        }
        if (
          continuation.delivery.status !== "PREPARING" ||
          continuation.delivery.expectedArrivalAt !== null ||
          continuation.delivery.vehiclePlate !== null
        ) {
          throw new HttpError(
            409,
            "Đơn giao hàng không ở trạng thái đang chuẩn bị để bắt đầu giao",
          );
        }
        // Chỉ chặn ở lần bắt đầu giao đầu tiên; replay idempotent với cùng giờ đã lưu vẫn hợp lệ dù giờ đó đã qua.
        if (expectedArrivalAt.getTime() <= now().getTime()) {
          throw new HttpError(
            422,
            "Giờ dự kiến đến phải sau thời điểm hiện tại",
          );
        }

        const updatedCount = await repository.dispatchDelivery(tx, {
          scope: liveScope,
          deliveryId: params.id,
          expectedArrivalAt,
          vehiclePlate: body.vehiclePlate,
        });

        const current = await repository.findManagementDeliveryById(
          tx,
          liveScope,
          params.id,
        );
        if (!current) {
          throw new HttpError(
            404,
            "Không tìm thấy đơn giao hàng thuộc nhà cung cấp",
          );
        }

        if (updatedCount !== 1) {
          if (
            current.workflowVersion === 2 &&
            current.status !== "PREPARING" &&
            matchesMetadata(current.expectedArrivalAt, current.vehiclePlate)
          ) {
            return mapSupplierOrderDetail(current, continuation.actor);
          }
          if (
            current.workflowVersion !== 2 ||
            current.traceabilityVersion !== 1
          ) {
            throw new HttpError(
              409,
              "Đơn giao hàng thuộc phiên bản cũ không thể cập nhật xuất kho hai bước",
            );
          }
          if (
            current.status === "CANCELLED" &&
            (current.expectedArrivalAt === null ||
              current.vehiclePlate === null)
          ) {
            throw new HttpError(
              409,
              "Đơn giao hàng đã bị hủy trước khi bắt đầu giao",
            );
          }
          throw new HttpError(
            409,
            "Trạng thái đơn giao hàng đã thay đổi trong lúc xử lý",
          );
        }

        proof = await proofs.prepareDeliveryDeclared(
          tx,
          params.id,
          continuation.actor.id,
        );
        return mapSupplierOrderDetail(current, continuation.actor);
      });
      proofs.scheduleAnchor(proof);
      return result;
    },
  };
}

export const supplierOrderService = createSupplierOrderService();
export type SupplierOrderService = ReturnType<
  typeof createSupplierOrderService
>;
