import { ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { currentAcademicYear } from "../class/academic-year";
import type { MenuApprovalDecisionRequestDTO } from "./menu-approval.request.dto";
import type {
  MenuApprovalDecisionResponseDTO,
  MenuApprovalDetailResponseDTO,
  MenuApprovalGradeCoverageDTO,
} from "./menu-approval.response.dto";
import {
  menuApprovalRepository,
  type ApprovalDecisionRow,
  type ApprovalDetailRow,
  type FinalizedPortionRow,
  type GradeCoverageRow,
  type MenuApprovalRepository,
} from "./menu-approval.repository";

const dayLabels = [
  "Chủ Nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
] as const;

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(value);
}

function formatDateTime(value: Date | null): string | null {
  return value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(value)
    : null;
}

function requireBoardSchool(principal: AuthPrincipal): string {
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId
  ) {
    throw new HttpError(403, "Chỉ Ban Giám hiệu được duyệt thực đơn");
  }
  return principal.schoolId;
}

const NUTRITION_ROLE_LABEL = "Nhân viên Dinh dưỡng";

/**
 * Số suất của một ngày = bữa đông nhất trong ngày (không cộng trưa + chiều),
 * vì cùng một học sinh có thể ăn cả hai bữa.
 */
function portionsByDate(
  rows: Pick<FinalizedPortionRow, "mealDate" | "totalPortions">[],
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = row.mealDate.toISOString().slice(0, 10);
    result.set(key, Math.max(result.get(key) ?? 0, row.totalPortions));
  }
  return result;
}

/** Cộng suất theo ngày rồi lấy bữa đông nhất của từng ngày, giống portionsByDate. */
function weeklyPortions(rows: GradeCoverageRow["portions"]): number {
  const byMeal = new Map<string, { mealDate: Date; totalPortions: number }>();
  for (const row of rows) {
    const key = `${row.mealDate.toISOString().slice(0, 10)}|${row.mealType}`;
    const current = byMeal.get(key);
    byMeal.set(key, {
      mealDate: row.mealDate,
      totalPortions: (current?.totalPortions ?? 0) + row.totalPortions,
    });
  }
  let total = 0;
  for (const value of portionsByDate([...byMeal.values()]).values()) {
    total += value;
  }
  return total;
}

function mapGradeCoverage(
  menu: ApprovalDetailRow,
  academicYear: string,
  coverage: GradeCoverageRow,
): MenuApprovalGradeCoverageDTO {
  const menuGradeIds = new Set(menu.grades?.map((grade) => grade.gradeId));
  const otherGradeIds = new Set(coverage.otherMenuGradeIds);
  const grades = coverage.grades.map((grade) => {
    const inThisMenu = menu.isSchoolWide || menuGradeIds.has(grade.id);
    return {
      id: grade.id,
      name: grade.name,
      activeClasses: grade.activeClasses,
      portions: weeklyPortions(
        coverage.portions.filter((row) => row.gradeId === grade.id),
      ),
      inThisMenu,
      hasMenuThisWeek:
        inThisMenu ||
        otherGradeIds.has(grade.id) ||
        coverage.hasOtherSchoolWideMenu,
    };
  });
  const warnings: string[] = [];
  const missing = grades.filter(
    (grade) => grade.activeClasses > 0 && !grade.hasMenuThisWeek,
  );
  if (missing.length) {
    warnings.push(
      `Khối chưa có thực đơn trong tuần: ${missing.map((grade) => grade.name).join(", ")}`,
    );
  }
  const emptyGrades = grades.filter(
    (grade) => grade.inThisMenu && grade.activeClasses === 0,
  );
  if (!menu.isSchoolWide && emptyGrades.length) {
    warnings.push(
      `Khối áp dụng chưa có lớp đang hoạt động năm ${academicYear}: ${emptyGrades.map((grade) => grade.name).join(", ")}`,
    );
  }
  if (coverage.unassignedActiveClasses > 0) {
    warnings.push(
      `${coverage.unassignedActiveClasses} lớp đang hoạt động chưa được gán khối${menu.isSchoolWide ? "" : " nên không thuộc thực đơn theo khối nào"}`,
    );
  }
  return {
    academicYear,
    grades,
    unassignedActiveClasses: coverage.unassignedActiveClasses,
    warnings,
  };
}

function mapDetail(
  menu: ApprovalDetailRow,
  finalizedPortions: FinalizedPortionRow[],
  coverage: GradeCoverageRow,
): MenuApprovalDetailResponseDTO {
  const healthReview = menu.menuReviewRecords.find(
    (review) => review.User.Role.code === ROLES.SCHOOL_NUTRITION_OFFICER,
  );
  const boardReview =
    menu.status === "PENDING_APPROVAL"
      ? undefined
      : menu.menuReviewRecords.find(
          (review) => review.User.Role.code === ROLES.SCHOOL_MANAGEMENT_BOARD,
        );
  const portions = portionsByDate(finalizedPortions);
  const days = menu.menuDays.map((day) => {
    const placements = day.menuDayDishes.map((placement) => ({
      mealType: placement.mealType,
      item: {
        name: placement.Dish.name,
        description: placement.Dish.description,
        supplier:
          [
            ...new Set(
              placement.ingredients.map(
                (link) => link.ingredient.Supplier.name,
              ),
            ),
          ].join(", ") || null,
      },
    }));
    return {
      id: day.id,
      shortLabel: dayLabels[day.menuDate.getUTCDay()] ?? "",
      date: formatDate(day.menuDate),
      portions: portions.get(day.menuDate.toISOString().slice(0, 10)) ?? 0,
      lunch: placements
        .filter((placement) => placement.mealType === "LUNCH")
        .map((placement) => placement.item),
      snack: placements
        .filter((placement) => placement.mealType === "AFTERNOON")
        .map((placement) => placement.item),
    };
  });
  const supplierIds = new Set(
    menu.menuDays.flatMap((day) =>
      day.menuDayDishes.flatMap((placement) =>
        placement.ingredients.map((link) => link.ingredient.Supplier.id),
      ),
    ),
  );
  const firstDate = menu.menuDays[0]?.menuDate ?? menu.weekStartDate;
  const lastDate = menu.menuDays.at(-1)?.menuDate ?? menu.weekStartDate;

  return {
    id: menu.id,
    title: menu.title,
    status: menu.status,
    canDecide: menu.status === "PENDING_APPROVAL",
    submittedAt: formatDateTime(menu.submittedAt),
    submissionVersion: menu.submittedAt?.toISOString() ?? null,
    summary: {
      audience:
        menu.grades?.map((grade) => grade.grade.name).join(", ") ||
        "Toàn trường",
      audienceDetail: "Số suất ăn được xác định theo kế hoạch phục vụ",
      servingPeriod: `${formatDate(firstDate)} - ${formatDate(lastDate)}`,
      proposer: menu.User?.fullName ?? NUTRITION_ROLE_LABEL,
      proposerDetail: `${NUTRITION_ROLE_LABEL} · ${menu.School.name}`,
      supplier: `${supplierIds.size} nhà cung cấp`,
    },
    compliance: [],
    days,
    gradeCoverage: mapGradeCoverage(
      menu,
      currentAcademicYear(menu.weekStartDate),
      coverage,
    ),
    medicalReview: {
      status:
        healthReview?.decision === "APPROVED"
          ? "Đã thẩm định"
          : healthReview
            ? "Yêu cầu điều chỉnh"
            : "Chưa thẩm định",
      isApproved: healthReview?.decision === "APPROVED",
      reviewer: healthReview?.User.fullName ?? "Chưa phân công",
      role: NUTRITION_ROLE_LABEL,
      reviewedAt: formatDateTime(healthReview?.reviewedAt ?? null) ?? "—",
      note: healthReview?.feedback ?? "Chưa có nhận xét thẩm định.",
      documents: [],
    },
    approval: {
      approver: boardReview?.User.fullName ?? null,
      role: "Ban Giám hiệu",
      note: boardReview?.feedback ?? "",
      reviewedAt: formatDateTime(boardReview?.reviewedAt ?? null),
    },
  };
}

function assertReady(menu: ApprovalDecisionRow): void {
  if (!menu.menuDays.length) {
    throw new HttpError(422, "Thực đơn chưa có ngày ăn");
  }
  if (
    menu.menuDays.some(
      (day) =>
        !day.menuDayDishes.length ||
        day.menuDayDishes.some(
          (dish) => dish.Dish.status !== "ACTIVE" || !dish.ingredients.length,
        ),
    )
  ) {
    throw new HttpError(422, "Mỗi món cần đầy đủ định mức trước khi phê duyệt");
  }
}

export function createMenuApprovalService(
  repository: MenuApprovalRepository = menuApprovalRepository,
) {
  return {
    async getDetail(
      id: string,
      principal: AuthPrincipal,
    ): Promise<MenuApprovalDetailResponseDTO> {
      assertPermission(principal, "menu.view");
      const schoolId = requireBoardSchool(principal);
      const menu = await repository.findDetail(id, schoolId);
      if (!menu) {
        throw new HttpError(404, "Không tìm thấy thực đơn của trường");
      }
      const dates = menu.menuDays.map((day) => day.menuDate);
      const [portions, coverage] = await Promise.all([
        repository.findFinalizedPortions(
          dates,
          schoolId,
          menu.grades?.map((grade) => grade.gradeId) ?? [],
        ),
        repository.findGradeCoverage({
          schoolId,
          weeklyMenuId: menu.id,
          weekStartDate: menu.weekStartDate,
          academicYear: currentAcademicYear(menu.weekStartDate),
          dates,
        }),
      ]);
      return mapDetail(menu, portions, coverage);
    },

    async decide(
      id: string,
      input: MenuApprovalDecisionRequestDTO,
      principal: AuthPrincipal,
    ): Promise<MenuApprovalDecisionResponseDTO> {
      const permission =
        input.decision === "APPROVED" ? "menu.approve" : "menu.review";
      const database = await repository.connect();
      return withSchoolTransaction(
        database,
        principal,
        permission,
        async (tx, actor, schoolId) => {
          requireBoardSchool(actor);
          const menu = await repository.findForDecision(tx, id, schoolId);
          if (!menu) {
            throw new HttpError(404, "Không tìm thấy thực đơn của trường");
          }
          if (menu.status !== "PENDING_APPROVAL") {
            throw new HttpError(409, "Thực đơn chưa chờ duyệt");
          }
          if (
            input.submissionVersion &&
            input.submissionVersion !== menu.submittedAt?.toISOString()
          ) {
            throw new HttpError(
              409,
              "Thực đơn đã được chỉnh sửa và gửi lại. Vui lòng tải lại trước khi duyệt.",
            );
          }
          if (input.decision === "APPROVED") assertReady(menu);

          const status =
            input.decision === "APPROVED" ? "APPROVED" : "REVISION_REQUIRED";
          const review = await repository.createReview(tx, {
            weeklyMenuId: id,
            reviewerUserId: actor.id,
            decision: input.decision,
            feedback: input.feedback,
          });
          await repository.updateAllDays(tx, id, status);
          await repository.updateWeek(
            tx,
            id,
            status,
            status === "APPROVED" ? review.reviewedAt : null,
          );
          return {
            weeklyMenuId: id,
            weeklyStatus: status,
            reviewedAt: review.reviewedAt.toISOString(),
            reviewer: {
              id: review.User.id,
              fullName: review.User.fullName,
            },
          };
        },
      );
    },
  };
}

export const menuApprovalService = createMenuApprovalService();
export type MenuApprovalService = ReturnType<typeof createMenuApprovalService>;
