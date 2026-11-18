import type { AuthPrincipal } from "../../types/auth";
import {
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { parseCanonicalComplaintCode } from "../../utils/complaint-code";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listWindow, readListPage } from "../../utils/list-query";
import { withReadTransaction } from "../../utils/read-transaction";
import {
  ingredientQualityFeedbackReadScope,
  ingredientQualityFeedbackResponseScope,
  type IngredientQualityFeedbackResponseScope,
} from "../../utils/resource-access";
import type {
  IngredientQualityFeedbackListQueryRequest,
  IngredientQualityFeedbackParamsRequest,
  IngredientQualityFeedbackResponseBodyRequest,
} from "./ingredient-quality-feedback.request.dto";
import type {
  FeedbackDetail,
  IngredientQualityFeedbackStatusDto,
  LegacyFeedbackList,
  LegacyFeedbackListItem,
  SupplierFeedbackList,
  SupplierFeedbackListItem,
} from "./ingredient-quality-feedback.response.dto";
import {
  ingredientQualityFeedbackRepository,
  type FeedbackDetailRow,
  type FeedbackDetailScope,
  type FeedbackLotRow,
  type IngredientQualityFeedbackRepository,
  type IngredientQualityFeedbackTx,
  type LegacyFeedbackRow,
  type SupplierFeedbackListRow,
} from "./ingredient-quality-feedback.repository";

const NOT_FOUND_MESSAGE = "Không tìm thấy khiếu nại trong phạm vi được phép";
const ALREADY_RESPONDED_MESSAGE = "Khiếu nại đã được phản hồi";
const SCOPE_CHANGED_MESSAGE = "Phạm vi tài khoản đã thay đổi";
const CORRUPT_DATA_MESSAGE = "Không thể tải dữ liệu. Vui lòng thử lại sau.";

function toFeedbackStatus(status: string): IngredientQualityFeedbackStatusDto {
  if (status === "SUBMITTED" || status === "RESPONDED") return status;
  throw new HttpError(503, CORRUPT_DATA_MESSAGE);
}

function assertStoredComplaintCode(complaintCode: string): string {
  if (parseCanonicalComplaintCode(complaintCode) === null) {
    throw new HttpError(503, CORRUPT_DATA_MESSAGE);
  }
  return complaintCode;
}

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

function toNullableIsoTimestamp(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapLegacyFeedbackItem(row: LegacyFeedbackRow): LegacyFeedbackListItem {
  const complaint = row.Complaint;
  const currentResponse = complaint.currentResponseVersion;
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    ingredientLotId: row.ingredientLotId ?? null,
    submittedByUserId: complaint.senderUserId,
    title: complaint.title ?? "",
    description: complaint.description,
    status: toFeedbackStatus(complaint.status),
    respondedAt: toNullableIsoTimestamp(currentResponse?.createdAt ?? null),
    createdAt: toIsoTimestamp(complaint.createdAt),
    updatedAt: toIsoTimestamp(complaint.updatedAt),
  };
}

function mapSupplierListItem(
  row: SupplierFeedbackListRow,
): SupplierFeedbackListItem {
  const complaint = row.Complaint;
  const currentResponse = complaint.currentResponseVersion;
  return {
    id: row.id,
    complaintCode: assertStoredComplaintCode(complaint.complaintCode),
    title: complaint.title ?? "",
    school: {
      id: row.Delivery.School.id,
      name: row.Delivery.School.name,
      code: row.Delivery.School.code ?? null,
    },
    delivery: {
      id: row.Delivery.id,
      deliveryNo: row.Delivery.deliveryNo,
    },
    status: toFeedbackStatus(complaint.status),
    createdAt: toIsoTimestamp(complaint.createdAt),
    respondedAt: toNullableIsoTimestamp(currentResponse?.createdAt ?? null),
  };
}

function mapFeedbackDetail(
  row: FeedbackDetailRow,
  lot: FeedbackLotRow | null,
): FeedbackDetail {
  const complaint = row.Complaint;
  const currentResponse = complaint.currentResponseVersion;
  const status = toFeedbackStatus(complaint.status);
  const complaintCode = assertStoredComplaintCode(complaint.complaintCode);
  if (status === "SUBMITTED" && currentResponse !== null) {
    throw new HttpError(503, CORRUPT_DATA_MESSAGE);
  }
  if (
    status === "RESPONDED" &&
    (currentResponse === null ||
      currentResponse.content === null ||
      currentResponse.respondedByUser === null ||
      currentResponse.createdAt === null)
  ) {
    throw new HttpError(503, CORRUPT_DATA_MESSAGE);
  }
  if (row.ingredientLotId !== null && lot === null) {
    throw new HttpError(503, CORRUPT_DATA_MESSAGE);
  }
  return {
    id: row.id,
    complaintCode,
    title: complaint.title ?? "",
    school: {
      id: row.Delivery.School.id,
      name: row.Delivery.School.name,
      code: row.Delivery.School.code ?? null,
    },
    delivery: {
      id: row.Delivery.id,
      deliveryNo: row.Delivery.deliveryNo,
    },
    status,
    createdAt: toIsoTimestamp(complaint.createdAt),
    respondedAt:
      status === "RESPONDED" && currentResponse?.createdAt
        ? toIsoTimestamp(currentResponse.createdAt)
        : null,
    description: complaint.description,
    updatedAt: toIsoTimestamp(complaint.updatedAt),
    submittedBy: {
      id: complaint.senderUser.id,
      fullName: complaint.senderUser.fullName,
    },
    ingredientLot: lot ? { id: lot.id, lotCode: lot.lotCode } : null,
    supplierResponse:
      status === "RESPONDED" && currentResponse
        ? currentResponse.content
        : null,
    respondedBy:
      status === "RESPONDED" && currentResponse?.respondedByUser
        ? {
            id: currentResponse.respondedByUser.id,
            fullName: currentResponse.respondedByUser.fullName,
          }
        : null,
  };
}

function assertActorMatchesOriginal(
  current: AuthPrincipal,
  original: AuthPrincipal,
  originalScope: IngredientQualityFeedbackResponseScope,
): void {
  const currentScope = ingredientQualityFeedbackResponseScope(current);
  if (
    current.id !== original.id ||
    current.role !== original.role ||
    current.orgType !== original.orgType ||
    currentScope.supplierId !== originalScope.supplierId
  ) {
    throw new HttpError(409, SCOPE_CHANGED_MESSAGE);
  }
}

export function createIngredientQualityFeedbackService(
  repository: IngredientQualityFeedbackRepository = ingredientQualityFeedbackRepository,
  connect = getPrisma,
) {
  async function readAndMapDetail(
    tx: IngredientQualityFeedbackTx,
    feedbackId: string,
    scope: FeedbackDetailScope,
  ): Promise<FeedbackDetail> {
    const row = await repository.findDetail(tx, feedbackId, scope);
    if (!row) throw new HttpError(404, NOT_FOUND_MESSAGE);
    const lot =
      row.ingredientLotId !== null
        ? await repository.findLotInDelivery(
            tx,
            row.ingredientLotId,
            row.deliveryId,
            scope,
          )
        : null;
    if (row.ingredientLotId !== null && !lot) {
      throw new HttpError(503, CORRUPT_DATA_MESSAGE);
    }
    return mapFeedbackDetail(row, lot);
  }

  return {
    async getAll(
      query: IngredientQualityFeedbackListQueryRequest,
      principal: AuthPrincipal,
    ): Promise<SupplierFeedbackList | LegacyFeedbackList> {
      const scope = ingredientQualityFeedbackReadScope(principal, "list");
      const { skip, take } = listWindow(query);
      if (scope.kind === "SUPPLIER") {
        const page = await readListPage(
          () => repository.listSupplier(scope, skip, take),
          query,
        );
        return {
          items: page.items.map(mapSupplierListItem),
          pagination: page.pagination,
        };
      }
      const page = await readListPage(
        () => repository.listLegacy(scope, skip, take),
        query,
      );
      return {
        items: page.items.map(mapLegacyFeedbackItem),
        pagination: page.pagination,
      };
    },
    async getDetail(
      params: IngredientQualityFeedbackParamsRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      const scope = ingredientQualityFeedbackReadScope(principal, "detail");
      return withReadTransaction(
        (tx) => readAndMapDetail(tx, params.feedbackId, scope),
        connect,
      );
    },
    async respond(
      params: IngredientQualityFeedbackParamsRequest,
      body: IngredientQualityFeedbackResponseBodyRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      const originalScope = ingredientQualityFeedbackResponseScope(principal);
      const db = await databaseOperation(() => connect());
      return authorizationTransaction(db, async (tx) => {
        const initialActor = await repository.readActor(tx, principal.id);
        assertActorMatchesOriginal(initialActor, principal, originalScope);

        const metadata = await repository.findResponseMetadata(
          tx,
          params.feedbackId,
          originalScope,
        );
        await repository.lockResponseContext(tx, originalScope, {
          feedbackId: params.feedbackId,
          actorUserId: principal.id,
          actorRoleId: principal.roleId,
          schoolId: metadata?.schoolId,
          deliveryId: metadata?.deliveryId,
        });

        const currentActor = await repository.readActor(tx, principal.id);
        assertActorMatchesOriginal(currentActor, principal, originalScope);

        if (!metadata) throw new HttpError(404, NOT_FOUND_MESSAGE);

        const target = await repository.findResponseTarget(
          tx,
          params.feedbackId,
          originalScope,
        );
        if (!target) throw new HttpError(404, NOT_FOUND_MESSAGE);
        if (
          target.deliveryId !== metadata.deliveryId ||
          target.schoolId !== metadata.schoolId
        ) {
          throw new HttpError(503, CORRUPT_DATA_MESSAGE);
        }
        if (target.status === "RESPONDED") {
          throw new HttpError(409, ALREADY_RESPONDED_MESSAGE);
        }
        if (target.status !== "SUBMITTED") {
          throw new HttpError(503, CORRUPT_DATA_MESSAGE);
        }

        const updatedCount = await repository.respondIfSubmitted(tx, {
          feedbackId: params.feedbackId,
          supplierId: originalScope.supplierId,
          supplierResponse: body.supplierResponse,
          respondedByUserId: currentActor.id,
          respondedRoleCode: currentActor.role,
          respondedAt: new Date(),
        });
        if (updatedCount === 0) {
          throw new HttpError(409, ALREADY_RESPONDED_MESSAGE);
        }

        return readAndMapDetail(tx, params.feedbackId, {
          kind: "SUPPLIER",
          supplierId: originalScope.supplierId,
        });
      });
    },
  };
}

export const ingredientQualityFeedbackService =
  createIngredientQualityFeedbackService();
export type IngredientQualityFeedbackService = ReturnType<
  typeof createIngredientQualityFeedbackService
>;
