import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { listWindow, readListPage } from "../../utils/list-query";
import {
  supplierOrderManagementScope,
  supplierOrderReadScope,
} from "../../utils/resource-access";
import { createIntakeAccessService } from "../account-lifecycle/intake-access.service";
import {
  supplierOrderRepository,
  type SupplierOrderDb,
  type SupplierOrderDetailRecord,
  type SupplierOrderIngredientOptionRecord,
  type SupplierOrderRepository,
  type SupplierOrderSchoolOptionRecord,
  type SupplierOrderSummaryRecord,
} from "./supplier-order.repository";
import type {
  CreateFromRequestBodyDTO,
  CreateStandaloneBodyDTO,
  CreateSupplierOrderBodyDTO,
  CreateSupplierOrderRequestDTO,
  SupplierOrderDetailParamsDTO,
  SupplierOrderListQueryDTO,
  SupplierOrderOptionsQueryDTO,
} from "./supplier-order.request.dto";
import type {
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
};

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
    ingredientName: item.Ingredient.name,
    ingredientEntryId: item.ingredientEntryId,
    supplyRequestItemId: item.supplyRequestItemId,
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
    schoolId: row.schoolId,
    schoolName: row.School.name,
    supplierId: row.supplierId,
    supplyRequestId: row.supplyRequestId,
    requestNo: row.SupplyRequest?.requestNo ?? null,
    status: row.status,
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

function canonicalArrivalIso(expectedArrivalAt: string | null): string | null {
  return expectedArrivalAt ? new Date(expectedArrivalAt).toISOString() : null;
}

function buildCreationFingerprint(body: CreateSupplierOrderBodyDTO): string {
  const common = {
    version: 1,
    mode: body.sourceType,
    expectedArrivalAt: canonicalArrivalIso(body.expectedArrivalAt),
    vehiclePlate: body.vehiclePlate,
    note: body.note,
  };
  const payload =
    body.sourceType === "REQUEST"
      ? {
          ...common,
          supplyRequestId: body.supplyRequestId,
        }
      : {
          ...common,
          schoolId: body.schoolId,
          items: [...body.items]
            .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))
            .map((item) => ({
              ingredientId: item.ingredientId,
              actualQuantity: new Prisma.Decimal(
                item.actualQuantity,
              ).toString(),
              unit: item.unit,
            })),
        };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return true;
  }
  if (error && typeof error === "object" && "cause" in error) {
    const cause = (error as { cause?: { originalCode?: string } }).cause;
    if (cause?.originalCode === "23505") return true;
  }
  return false;
}

export function createSupplierOrderService(
  repository: SupplierOrderRepository = supplierOrderRepository,
  dependencies?: Dependencies,
) {
  const transaction =
    dependencies?.transaction ??
    (async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      authorizationTransaction(
        await databaseOperation(() => repository.connect()),
        fn,
      ));
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

  async function createFromRequest(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    idempotencyKey: string,
    fingerprint: string,
    body: CreateFromRequestBodyDTO,
  ): Promise<SupplierOrderCreateResultDTO> {
    const actor = await guard.assertAccess(tx, principal, {
      operation: "START_ORDER_PROCESSING",
      orderId: body.supplyRequestId,
      requiredPermission: "delivery.manage",
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

    const created = await repository.createDeliveryWithItems(tx, {
      deliveryNo: `DG-${randomUUID()}`,
      creationMode: "REQUEST",
      creationKey: idempotencyKey,
      creationFingerprint: fingerprint,
      schoolId: requestRow.schoolId,
      supplierId: liveScope.supplierId,
      supplyRequestId: requestRow.id,
      createdByUserId: actor.id,
      expectedArrivalAt: body.expectedArrivalAt
        ? new Date(body.expectedArrivalAt)
        : null,
      vehiclePlate: body.vehiclePlate,
      note: body.note,
      status: "CREATED",
      items: requestRow.supplyRequestItems.map((item) => ({
        supplyRequestItemId: item.id,
        ingredientId: item.IngredientEntry.ingredientId,
        ingredientEntryId: item.ingredientEntryId,
        actualQuantity: item.requestedQuantity,
        unit: item.unit,
        note: item.note,
      })),
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
  ): Promise<SupplierOrderCreateResultDTO> {
    const ingredientIds = body.items.map((item) => item.ingredientId);
    const actor = await guard.assertAccess(tx, principal, {
      operation: "SUPPLIER_CREATE_STANDALONE_DELIVERY",
      schoolId: body.schoolId,
      ingredientIds,
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

    const activeEntries = await repository.findIngredientEntriesForSchool(
      tx,
      body.schoolId,
      ingredientIds,
    );
    const entryByIngredientId = new Map(
      activeEntries.map((entry) => [entry.ingredientId, entry.id]),
    );

    const created = await repository.createDeliveryWithItems(tx, {
      deliveryNo: `DG-${randomUUID()}`,
      creationMode: "STANDALONE",
      creationKey: idempotencyKey,
      creationFingerprint: fingerprint,
      schoolId: body.schoolId,
      supplierId: liveScope.supplierId,
      supplyRequestId: null,
      createdByUserId: actor.id,
      expectedArrivalAt: body.expectedArrivalAt
        ? new Date(body.expectedArrivalAt)
        : null,
      vehiclePlate: body.vehiclePlate,
      note: body.note,
      status: "CREATED",
      items: body.items.map((item) => ({
        supplyRequestItemId: null,
        ingredientId: item.ingredientId,
        ingredientEntryId: entryByIngredientId.get(item.ingredientId) ?? null,
        actualQuantity: new Prisma.Decimal(item.actualQuantity),
        unit: item.unit,
        note: null,
      })),
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
            );
          }

          return createStandalone(
            tx,
            principal,
            input.idempotencyKey,
            fingerprint,
            input.body,
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
        throw new HttpError(409, "Yêu cầu cung ứng này đã có đợt giao");
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
