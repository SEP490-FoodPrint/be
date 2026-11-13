import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { listScopes } from "../../utils/resource-access";
import { readListPage } from "../../utils/list-query";
import { HttpError } from "../../utils/http-error";
import { createIntakeAccessService } from "../account-lifecycle/intake-access.service";
import {
  createReportingRepository,
  type ReportingRepository,
  type ReceivedReportRow,
} from "./reporting.repository";
import type {
  ReportingListRequestDTO,
  ReportingReceiveParamsRequestDTO,
} from "./reporting.request.dto";
import type {
  ReportingListResponseDTO,
  ReportingReceiveResponseDTO,
} from "./reporting.response.dto";

type Dependencies = {
  transaction: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  guard: Pick<ReturnType<typeof createIntakeAccessService>, "assertAccess">;
};
function mapReceipt(row: ReceivedReportRow): ReportingReceiveResponseDTO {
  if (!row.recipientUserId || !row.receivedAt)
    throw new HttpError(409, "Không thể xác nhận tiếp nhận yêu cầu");
  return {
    id: row.id,
    incidentId: row.incidentId,
    recipientUserId: row.recipientUserId,
    receivedAt: row.receivedAt.toISOString(),
  };
}
export function createReportingService(
  repository: ReportingRepository = createReportingRepository(),
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
      query: ReportingListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ReportingListResponseDTO> {
      const scope = listScopes.reporting(principal);
      const page = await readListPage(
        () => repository.list(query, scope),
        query,
      );
      return {
        items: page.items.map((row) => ({
          id: row.id,
          incidentId: row.incidentId,
          recipientCommuneFoodSafetyUnitId:
            row.recipientCommuneFoodSafetyUnitId,
          recipientOrganization: row.recipientOrganization,
          referenceNumber: row.referenceNumber,
          status: row.status,
          attemptedAt: row.attemptedAt?.toISOString() ?? null,
          forwardedAt: row.forwardedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        pagination: page.pagination,
      };
    },
    async receive(
      params: ReportingReceiveParamsRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ReportingReceiveResponseDTO> {
      if (
        principal.orgType !== "AUTHORITY" ||
        principal.role !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
        !principal.communeFoodSafetyUnitId
      )
        throw new HttpError(403, "Chỉ cán bộ ATTP được nhận yêu cầu");
      assertPermission(principal, "food_safety_report.receive");
      return transaction(async (tx) => {
        const actor = await guard.assertAccess(tx, principal, {
          operation: "OFFICER_RECEIVE_REQUEST",
          forwardingId: params.id,
        });
        if (
          actor.orgType !== "AUTHORITY" ||
          actor.role !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
          !actor.communeFoodSafetyUnitId
        )
          throw new HttpError(403, "Phạm vi cán bộ đã thay đổi");
        const report = await repository.findForOfficer(
          tx,
          params.id,
          actor.id,
          actor.communeFoodSafetyUnitId,
        );
        if (!report)
          throw new HttpError(404, "Không tìm thấy yêu cầu kiểm tra");
        if (report.receivedAt) return mapReceipt(report);
        if (report.FoodSafetyIncident.status === "CLOSED")
          throw new HttpError(409, "Yêu cầu kiểm tra đã đóng");
        const count = await repository.receive(
          tx,
          report.id,
          actor.id,
          actor.communeFoodSafetyUnitId,
          new Date(),
        );
        if (count !== 1)
          throw new HttpError(409, "Trạng thái yêu cầu đã thay đổi");
        const updated = await repository.findForOfficer(
          tx,
          report.id,
          actor.id,
          actor.communeFoodSafetyUnitId,
        );
        if (!updated)
          throw new HttpError(409, "Không thể xác nhận tiếp nhận yêu cầu");
        return mapReceipt(updated);
      });
    },
  };
}
export const reportingService = createReportingService();
export type ReportingService = ReturnType<typeof createReportingService>;
