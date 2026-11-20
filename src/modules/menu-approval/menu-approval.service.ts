import { ROLES } from "../../constants/roles";
import { notifyMenuDecision } from "../menu-notification/menu-notification.service";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  calculateAcademicWeekNumber,
  getSchoolMonday,
} from "../../utils/date-time";
import { assertCompleteMenuWeek } from "../../utils/menu-week";
import type {
  MenuApprovalDecisionRequestDTO,
  MenuApprovalWeekQueryRequestDTO,
} from "./menu-approval.request.dto";
import type {
  MenuApprovalDecisionResponseDTO,
  MenuApprovalDetailResponseDTO,
  MenuApprovalWeekOptionDTO,
  MenuApprovalWeekResponseDTO,
} from "./menu-approval.response.dto";
import {
  menuApprovalRepository,
  type ApprovalDecisionRow,
  type ApprovalDetailRow,
  type FinalizedPortionRow,
  type MenuApprovalRepository,
  type SubmittedWeekRow,
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

/** Số suất một ngày = bữa đông nhất (không cộng trưa + chiều). */
function portionsByDate(
  rows: FinalizedPortionRow[],
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = row.mealDate.toISOString().slice(0, 10);
    result.set(key, Math.max(result.get(key) ?? 0, row.totalPortions));
  }
  return result;
}

function mapDetail(
  menu: ApprovalDetailRow,
  finalizedPortions: FinalizedPortionRow[],
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
    isSchoolWide: menu.isSchoolWide,
    grades: (menu.grades ?? []).map((grade) => ({
      id: grade.gradeId,
      name: grade.grade.name,
    })),
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

const DAY_MS = 86400000;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const fridayOf = (monday: Date) => new Date(monday.getTime() + 4 * DAY_MS);

/** Gom số thực đơn đã gửi theo tuần, mới nhất trước. */
function weekOptions(rows: SubmittedWeekRow[]): MenuApprovalWeekOptionDTO[] {
  const byWeek = new Map<string, MenuApprovalWeekOptionDTO>();
  for (const row of rows) {
    const key = isoDate(row.weekStartDate);
    const option = byWeek.get(key) ?? {
      weekStartDate: key,
      weekEndDate: isoDate(fridayOf(row.weekStartDate)),
      total: 0,
      pending: 0,
    };
    option.total += row.count;
    if (row.status === "PENDING_APPROVAL") option.pending += row.count;
    byWeek.set(key, option);
  }
  return [...byWeek.values()].sort((a, b) =>
    b.weekStartDate.localeCompare(a.weekStartDate),
  );
}

/** Mặc định: tuần còn chờ duyệt mới nhất, nếu không có thì tuần mới nhất. */
function defaultWeek(weeks: MenuApprovalWeekOptionDTO[]): string | null {
  return (
    weeks.find((week) => week.pending > 0)?.weekStartDate ??
    weeks[0]?.weekStartDate ??
    null
  );
}

const gradeCollator = new Intl.Collator("vi", { numeric: true });
// Thực đơn toàn trường đứng đầu, sau đó theo tên khối (Khối 1, Khối 2, ...)
const menuSortKey = (menu: MenuApprovalDetailResponseDTO) =>
  menu.isSchoolWide ? "" : menu.grades.map((grade) => grade.name).join(", ");

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

export type MenuDecisionNotifier = typeof notifyMenuDecision;

export function createMenuApprovalService(
  repository: MenuApprovalRepository = menuApprovalRepository,
  // Chỉ gửi email khi chạy với repository thật (test dùng repository giả sẽ không gửi mail).
  notifier: MenuDecisionNotifier | null = repository === menuApprovalRepository
    ? notifyMenuDecision
    : null,
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
      const portions = await repository.findFinalizedPortions(
        menu.menuDays.map((day) => day.menuDate),
        schoolId,
        menu.grades?.map((grade) => grade.gradeId) ?? [],
      );
      return mapDetail(menu, portions);
    },

    /** Chi tiết mọi thực đơn đã gửi của một tuần trong một lần gọi. */
    async getWeek(
      query: MenuApprovalWeekQueryRequestDTO,
      principal: AuthPrincipal,
    ): Promise<MenuApprovalWeekResponseDTO> {
      const schoolId = requireBoardSchool(principal);
      // Phạm vi danh sách theo ma trận phân quyền: menu.view + lọc theo trường
      const scope = listScopes.menu(principal);
      const weeks = weekOptions(await repository.listSubmittedWeeks(scope));
      const selected = query.date
        ? isoDate(getSchoolMonday(query.date))
        : defaultWeek(weeks);
      if (!selected) {
        return {
          weekStartDate: null,
          weekEndDate: null,
          weekNumber: null,
          weeks,
          menus: [],
        };
      }
      const monday = new Date(selected + "T00:00:00.000Z");
      const database = await repository.connect();
      const [rows, years] = await Promise.all([
        repository.findWeekDetails(scope, monday),
        repository.academicYears(database, schoolId),
      ]);
      const menus = await Promise.all(
        rows.map(async (row) =>
          mapDetail(
            row,
            await repository.findFinalizedPortions(
              row.menuDays.map((day) => day.menuDate),
              schoolId,
              row.grades?.map((grade) => grade.gradeId) ?? [],
            ),
          ),
        ),
      );
      menus.sort((a, b) =>
        gradeCollator.compare(menuSortKey(a), menuSortKey(b)),
      );
      const year = years.find(
        (item) =>
          getSchoolMonday(item.startDate) <= monday &&
          monday.getTime() <
            getSchoolMonday(item.endDate).getTime() + 7 * DAY_MS,
      );
      return {
        weekStartDate: selected,
        weekEndDate: isoDate(fridayOf(monday)),
        weekNumber: year
          ? calculateAcademicWeekNumber(monday, year.startDate)
          : null,
        weeks,
        menus,
      };
    },

    async decide(
      id: string,
      input: MenuApprovalDecisionRequestDTO,
      principal: AuthPrincipal,
    ): Promise<MenuApprovalDecisionResponseDTO> {
      const permission =
        input.decision === "APPROVED" ? "menu.approve" : "menu.review";
      const database = await repository.connect();
      const result: MenuApprovalDecisionResponseDTO =
        await withSchoolTransaction(
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
            if (input.decision === "APPROVED") {
              assertCompleteMenuWeek(
                menu,
                await repository.academicYears(tx, schoolId),
              );
              assertReady(menu);
            }

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
      // Email báo cho nhân viên dinh dưỡng sau khi quyết định đã lưu; không chờ, không làm hỏng phản hồi.
      if (notifier)
        void notifier(id, {
          status: result.weeklyStatus,
          feedback: input.feedback,
          reviewerName: result.reviewer.fullName,
          reviewedAt: new Date(result.reviewedAt),
        }).catch(() =>
          console.warn("Chưa gửi được email thông báo duyệt thực đơn."),
        );
      return result;
    },
  };
}

export const menuApprovalService = createMenuApprovalService();
export type MenuApprovalService = ReturnType<typeof createMenuApprovalService>;
