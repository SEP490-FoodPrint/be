import { createHash } from "node:crypto";
import { readPublicTraceOrigin } from "../../config/env";
import { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { databaseOperation, loadPrincipal } from "../../utils/authorization";
import { formatDeliveryCode } from "../../utils/delivery-code";
import { getDeliveryStatusLabel } from "../../utils/delivery-status";
import { HttpError } from "../../utils/http-error";
import { listWindow, readListPage } from "../../utils/list-query";
import {
  buildDeliveryTraceUrl,
  generateDeliveryQrToken,
  renderDeliveryQrBatch,
} from "../../utils/qr-code";
import {
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
  SupplierOrderDetailParamsDTO,
  SupplierOrderLabelsQueryDTO,
  SupplierOrderListQueryDTO,
  SupplierOrderOptionsQueryDTO,
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
  transaction?: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  guard?: Pick<ReturnType<typeof createIntakeAccessService>, "assertAccess">;
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
): SupplierOrderSummaryDTO {
  return {
    id: row.id,
    deliveryNo: row.deliveryNo,
    sourceType: resolveSourceType(row.creationMode, row.supplyRequestId),
    traceabilityVersion: row.traceabilityVersion,
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
): SupplierOrderDetailDTO {
  return {
    ...mapSupplierOrderSummary(row),
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

function canonicalArrivalIso(expectedArrivalAt: string | null): string | null {
  return expectedArrivalAt ? new Date(expectedArrivalAt).toISOString() : null;
}

function buildCreationFingerprint(body: CreateSupplierOrderBodyDTO): string {
  const payload =
    body.sourceType === "REQUEST"
      ? {
          version: 2,
          mode: body.sourceType,
          expectedArrivalAt: canonicalArrivalIso(body.expectedArrivalAt),
          vehiclePlate: body.vehiclePlate,
          note: body.note,
          supplyRequestId: body.supplyRequestId,
          sources: [...body.sources]
            .sort((a, b) =>
              a.supplyRequestItemId.localeCompare(b.supplyRequestItemId),
            )
            .map((source) => ({
              supplyRequestItemId: source.supplyRequestItemId,
              sourceFacilityId: source.sourceFacilityId,
            })),
        }
      : {
          version: 2,
          mode: body.sourceType,
          expectedArrivalAt: canonicalArrivalIso(body.expectedArrivalAt),
          vehiclePlate: body.vehiclePlate,
          note: body.note,
          schoolId: body.schoolId,
          items: [...body.items]
            .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))
            .map((item) => ({
              ingredientId: item.ingredientId,
              sourceFacilityId: item.sourceFacilityId,
              actualQuantity: new Prisma.Decimal(
                item.actualQuantity,
              ).toString(),
              unit: item.unit,
            })),
        };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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
  const guard = dependencies?.guard ?? createIntakeAccessService();
  const verifyActor =
    dependencies?.verifyActor ??
    (async (db: SupplierOrderDb, principal: AuthPrincipal) => {
      const liveActor = await loadPrincipal(principal.id, db);
      if (
        !liveActor ||
        liveActor.orgType !== principal.orgType ||
        liveActor.supplierId !== principal.supplierId ||
        liveActor.role !== principal.role
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

  async function reserveNextDeliveryNo(
    tx: Prisma.TransactionClient,
    supplierId: string,
  ): Promise<string> {
    await repository.lockSupplierForDeliveryNumber(tx, supplierId);
    const highestSeq = await repository.findHighestCanonicalDeliverySequence(
      tx,
      supplierId,
    );
    return formatDeliveryCode(highestSeq + 1n);
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

    const selectionByItemId = new Map(
      body.sources.map((source) => [
        source.supplyRequestItemId,
        source.sourceFacilityId,
      ]),
    );
    if (
      selectionByItemId.size !== requestRow.supplyRequestItems.length ||
      requestRow.supplyRequestItems.some(
        (item) => !selectionByItemId.has(item.id),
      )
    ) {
      throw new HttpError(
        409,
        "Danh sách nguồn cung ứng phải khớp chính xác toàn bộ dòng của yêu cầu cung ứng",
      );
    }

    const facilityById = await resolveAndValidateSourceFacilities(
      tx,
      liveScope.supplierId,
      sourceFacilityIds,
    );
    const deliveryNo = await reserveNextDeliveryNo(tx, liveScope.supplierId);

    const created = await repository.createDeliveryWithItems(tx, {
      deliveryNo,
      creationMode: "REQUEST",
      creationKey: idempotencyKey,
      creationFingerprint: fingerprint,
      traceabilityVersion: 1,
      schoolId: requestRow.schoolId,
      supplierId: liveScope.supplierId,
      supplyRequestId: requestRow.id,
      createdByUserId: actor.id,
      expectedArrivalAt: new Date(body.expectedArrivalAt),
      vehiclePlate: body.vehiclePlate,
      note: body.note,
      status: "IN_TRANSIT",
      items: requestRow.supplyRequestItems.map((item, idx) => {
        const sourceFacilityId = selectionByItemId.get(item.id)!;
        const facility = facilityById.get(sourceFacilityId)!;
        const candidate = candidates[idx];
        return {
          supplyRequestItemId: item.id,
          ingredientId: item.IngredientEntry.ingredientId,
          ingredientEntryId: item.ingredientEntryId,
          sourceFacilityId: facility.id,
          sourceFacilityNameSnapshot: facility.name,
          sourceFacilityCodeSnapshot: facility.facilityCode,
          ingredientNameSnapshot: item.IngredientEntry.Ingredient.name,
          qrToken: candidate.qrToken,
          qrUrl: candidate.qrUrl,
          actualQuantity: item.requestedQuantity,
          unit: item.unit,
          note: item.note,
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

    return { ...mapSupplierOrderDetail(created), created: true };
  }

  async function createStandalone(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    idempotencyKey: string,
    fingerprint: string,
    body: CreateStandaloneBodyDTO,
    candidates: readonly PreparedQrCandidate[],
  ): Promise<SupplierOrderCreateResultDTO> {
    const ingredientIds = body.items.map((item) => item.ingredientId);
    const sourceFacilityIds = body.items.map((item) => item.sourceFacilityId);
    const actor = await guard.assertAccess(tx, principal, {
      operation: "SUPPLIER_CREATE_STANDALONE_DELIVERY",
      schoolId: body.schoolId,
      ingredientIds,
      sourceFacilityIds,
    });
    const liveScope = supplierOrderManagementScope(actor);

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
    const deliveryNo = await reserveNextDeliveryNo(tx, liveScope.supplierId);

    const created = await repository.createDeliveryWithItems(tx, {
      deliveryNo,
      creationMode: "STANDALONE",
      creationKey: idempotencyKey,
      creationFingerprint: fingerprint,
      traceabilityVersion: 1,
      schoolId: body.schoolId,
      supplierId: liveScope.supplierId,
      supplyRequestId: null,
      createdByUserId: actor.id,
      expectedArrivalAt: new Date(body.expectedArrivalAt),
      vehiclePlate: body.vehiclePlate,
      note: body.note,
      status: "IN_TRANSIT",
      items: body.items.map((item, idx) => {
        const ingredient = ingredientById.get(item.ingredientId)!;
        const facility = facilityById.get(item.sourceFacilityId)!;
        const candidate = candidates[idx];
        return {
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
        };
      }),
    });

    return { ...mapSupplierOrderDetail(created), created: true };
  }

  return {
    async create(
      input: CreateSupplierOrderRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierOrderCreateResultDTO> {
      const scope = supplierOrderManagementScope(principal);
      const fingerprint = buildCreationFingerprint(input.body);
      const candidates = await prepareQrCandidates(
        input.body.sourceType === "REQUEST"
          ? input.body.sources.length
          : input.body.items.length,
      );

      try {
        return await transaction(async (tx) => {
          const existing = await repository.findByCreationKey(
            tx,
            scope.supplierId,
            principal.id,
            input.idempotencyKey,
          );
          if (existing) {
            await verifyActor(tx, principal);
            if (existing.creationFingerprint !== fingerprint) {
              throw new HttpError(
                409,
                "Idempotency-Key đã được sử dụng cho nội dung đơn giao khác",
              );
            }
            return { ...mapSupplierOrderDetail(existing), created: false };
          }

          if (input.body.sourceType === "REQUEST") {
            return createFromRequest(
              tx,
              principal,
              input.idempotencyKey,
              fingerprint,
              input.body,
              candidates,
            );
          }

          return createStandalone(
            tx,
            principal,
            input.idempotencyKey,
            fingerprint,
            input.body,
            candidates,
          );
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const resolved = await databaseOperation(async () => {
          const db = await repository.connect();
          const replay = await repository.findByCreationKey(
            db,
            scope.supplierId,
            principal.id,
            input.idempotencyKey,
          );
          if (!replay) return null;
          await verifyActor(db, principal);
          return replay;
        });
        if (resolved) {
          if (resolved.creationFingerprint !== fingerprint) {
            throw new HttpError(
              409,
              "Idempotency-Key đã được sử dụng cho nội dung đơn giao khác",
            );
          }
          return { ...mapSupplierOrderDetail(resolved), created: false };
        }
        const constraint = getUniqueConstraintName(error);
        if (
          constraint === "uq_deliveries_request_mode" ||
          (input.body.sourceType === "REQUEST" && !constraint)
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
      query: SupplierOrderOptionsQueryDTO,
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
        items: page.items.map(mapSupplierOrderSummary),
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
      return mapSupplierOrderDetail(row);
    },
  };
}

export const supplierOrderService = createSupplierOrderService();
export type SupplierOrderService = ReturnType<
  typeof createSupplierOrderService
>;
