import { ORG_TYPES, ROLES } from "../../constants/roles";
import type { PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { currentAcademicYear } from "../class/academic-year";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { isComplaintSubmitter, listScopes } from "../../utils/resource-access";
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
  ComplaintMealOptionsDTO,
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
  const portion = row.DailyMealPortion;
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
      dailyMealPortionId: portion.id,
      allocationId: portion.MealAllocation?.id ?? null,
      allocationStatus: portion.MealAllocation?.status ?? null,
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
  now = () => new Date(),
) {
  const formatDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const requireRole = (principal: AuthPrincipal, role: string) => {
    if (principal.orgType !== ORG_TYPES.SCHOOL || principal.role !== role)
      throw new HttpError(
        403,
        "Vai trò không được phép thực hiện thao tác này",
      );
  };
  async function readMealOptions(
    db: Parameters<FeedbackRepository["findMealOptions"]>[0],
    principal: AuthPrincipal,
  ): Promise<ComplaintMealOptionsDTO> {
    assertPermission(principal, "meal_complaint.submit");
    if (
      principal.orgType !== ORG_TYPES.SCHOOL ||
      !principal.schoolId ||
      !isComplaintSubmitter(principal.role)
    )
      throw new HttpError(403, "Vai trò không được phép gửi khiếu nại");
    const timestamp = now();
    const mealDate = formatDate.format(timestamp);
    const teacher =
      principal.role === ROLES.HOMEROOM_TEACHER
        ? {
            id: principal.id,
            academicYear: currentAcademicYear(timestamp),
            now: timestamp,
          }
        : undefined;
    const classes = await repository.findMealOptions(
      db,
      principal.schoolId,
      new Date(mealDate),
      teacher,
    );
    if (teacher && classes.length !== 1)
      throw new HttpError(
        classes.length ? 409 : 404,
        classes.length
          ? "Phân công chủ nhiệm đang có mâu thuẫn"
          : "Chưa có phân công chủ nhiệm trong niên khóa hiện tại",
      );
    return {
      mealDate,
      classes: classes.map((item) => {
        const option = (mealType: "LUNCH" | "AFTERNOON") => {
          const portion = item.dailyMealPortions.find(
            (row) => row.mealType === mealType,
          );
          const status = portion?.MealAllocation?.status;
          return portion
            ? {
                dailyMealPortionId: portion.id,
                canComplain: status === "DISTRIBUTED" || status === "FINALIZED",
              }
            : null;
        };
        return {
          classId: item.id,
          className: item.name,
          lunch: option("LUNCH"),
          afternoon: option("AFTERNOON"),
        };
      }),
    };
  }
  return {
    async mealOptions(principal: AuthPrincipal) {
      return readMealOptions(await connect(), principal);
    },
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
      if (!isComplaintSubmitter(principal.role))
        throw new HttpError(403, "Vai trò không được phép gửi khiếu nại");
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_complaint.submit",
        async (tx, actor) => {
          const options = await readMealOptions(tx, actor);
          const meal = options.classes
            .flatMap(({ lunch, afternoon }) => [lunch, afternoon])
            .find(
              (option) =>
                option?.dailyMealPortionId === input.dailyMealPortionId,
            );
          if (!meal)
            throw new HttpError(
              404,
              "Suất ăn không thuộc phạm vi được gửi hôm nay",
            );
          if (!meal.canComplain)
            throw new HttpError(409, "Bữa ăn chưa được xác nhận giao");
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
