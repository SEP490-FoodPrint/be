import { ORG_TYPES, ROLES } from "../../constants/roles";
import type { PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { withSchoolTransaction } from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  createFeedbackRepository,
  type ComplaintRow,
  type FeedbackRepository,
} from "./feedback.repository";
import type {
  ComplaintListQueryDTO,
  CreateComplaintRequestDTO,
  RespondComplaintRequestDTO,
} from "./feedback.request.dto";
import type {
  ComplaintListResponseDTO,
  ComplaintResponseDTO,
} from "./feedback.response.dto";

function allowedActions(
  row: ComplaintRow,
  principal: AuthPrincipal,
): Array<"START_REVIEW" | "RESOLVE"> {
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    !principal.permissions.includes("meal_complaint.respond")
  )
    return [];
  if (row.status === "SUBMITTED") return ["START_REVIEW", "RESOLVE"];
  if (row.status === "IN_REVIEW") return ["RESOLVE"];
  return [];
}
function toResponse(
  row: ComplaintRow,
  principal: AuthPrincipal,
): ComplaintResponseDTO {
  const portion = row.MealAllocation.DailyMealPortion;
  return {
    id: row.id,
    complaintType: row.complaintType,
    description: row.description,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: row.resolution,
    submitter: row.submittedByUser,
    handler: row.handledByUser,
    meal: {
      allocationId: row.MealAllocation.id,
      allocationStatus: row.MealAllocation.status,
      classId: portion.Class.id,
      className: portion.Class.name,
      academicYear: portion.Class.academicYear,
      mealDate: portion.mealDate.toISOString().slice(0, 10),
      mealType: portion.mealType,
    },
    allowedActions: allowedActions(row, principal),
  };
}

export function createFeedbackService(
  repository: FeedbackRepository = createFeedbackRepository(),
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  const requireRole = (principal: AuthPrincipal, role: string) => {
    if (principal.orgType !== ORG_TYPES.SCHOOL || principal.role !== role)
      throw new HttpError(
        403,
        "Vai trò không được phép thực hiện thao tác này",
      );
  };
  return {
    async getAll(
      query: ComplaintListQueryDTO,
      principal: AuthPrincipal,
    ): Promise<ComplaintListResponseDTO> {
      const rows = await repository.list(
        await connect(),
        listScopes.feedback(principal),
        query,
      );
      return {
        items: rows
          .slice(0, query.limit)
          .map((row) => toResponse(row, principal)),
        pagination: {
          page: query.page,
          limit: query.limit,
          hasNext: rows.length > query.limit,
        },
      };
    },
    async getOne(id: string, principal: AuthPrincipal) {
      const row = await repository.findOne(
        await connect(),
        listScopes.feedback(principal),
        id,
      );
      if (!row) throw new HttpError(404, "Không tìm thấy khiếu nại");
      return toResponse(row, principal);
    },
    async create(input: CreateComplaintRequestDTO, principal: AuthPrincipal) {
      requireRole(principal, ROLES.HOMEROOM_TEACHER);
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_complaint.submit",
        async (tx, actor, schoolId) => {
          requireRole(actor, ROLES.HOMEROOM_TEACHER);
          const allocation = await repository.findAllocation(
            tx,
            input.mealAllocationId,
            schoolId,
            actor.id,
          );
          if (!allocation)
            throw new HttpError(
              404,
              "Không tìm thấy suất ăn hợp lệ để khiếu nại",
            );
          const mealDate = allocation.DailyMealPortion.mealDate;
          const dayStart = new Date(mealDate);
          dayStart.setUTCHours(0, 0, 0, 0);
          const dayEnd = new Date(mealDate);
          dayEnd.setUTCHours(23, 59, 59, 999);
          const assigned =
            allocation.DailyMealPortion.Class.homeroomAssignments.some(
              (item) =>
                item.assignedAt <= dayEnd &&
                (!item.endedAt || item.endedAt >= dayStart),
            );
          if (!assigned)
            throw new HttpError(
              403,
              "Suất ăn không thuộc thời gian phân công chủ nhiệm của bạn",
            );
          return toResponse(
            await repository.create(tx, {
              ...input,
              submittedByUserId: actor.id,
            }),
            actor,
          );
        },
      );
    },
    async respond(
      id: string,
      input: RespondComplaintRequestDTO,
      principal: AuthPrincipal,
    ) {
      requireRole(principal, ROLES.SCHOOL_MANAGEMENT_BOARD);
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_complaint.respond",
        async (tx, actor) => {
          requireRole(actor, ROLES.SCHOOL_MANAGEMENT_BOARD);
          const row = await repository.findOne(
            tx,
            listScopes.feedback(actor),
            id,
          );
          if (!row)
            throw new HttpError(404, "Không tìm thấy khiếu nại trong trường");
          if (input.action === "START_REVIEW") {
            if (row.status !== "SUBMITTED")
              throw new HttpError(409, "Chỉ khiếu nại mới gửi được tiếp nhận");
            return toResponse(
              await repository.updateStatus(tx, id, {
                status: "IN_REVIEW",
                handledByUserId: actor.id,
              }),
              actor,
            );
          }
          if (!input.resolution)
            throw new HttpError(400, "Cần nhập kết quả xử lý");
          if (row.status !== "SUBMITTED" && row.status !== "IN_REVIEW")
            throw new HttpError(
              409,
              "Trạng thái khiếu nại không cho phép phản hồi",
            );
          return toResponse(
            await repository.updateStatus(tx, id, {
              status: "RESOLVED",
              handledByUserId: actor.id,
              resolution: input.resolution,
              resolvedAt: new Date(),
            }),
            actor,
          );
        },
      );
    },
  };
}
export const feedbackService = createFeedbackService();
export type FeedbackService = ReturnType<typeof createFeedbackService>;
