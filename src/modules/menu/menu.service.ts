import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { aggregateDayStatus, decisionTargets } from "./menu-approval";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const listSelect = {
  id: true,
  schoolId: true,
  weekStartDate: true,
  title: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.WeeklyMenuSelect;

const approvalInclude = {
  School: { select: { name: true } },
  menuDays: {
    orderBy: { menuDate: "asc" as const },
    include: {
      menuDayDishes: {
        orderBy: { displayOrder: "asc" as const },
        include: {
          Dish: {
            include: {
              dishIngredientEntries: {
                include: {
                  IngredientEntry: {
                    include: {
                      Ingredient: {
                        include: {
                          Supplier: { select: { id: true, name: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  menuReviewRecords: {
    orderBy: { reviewedAt: "desc" as const },
    include: {
      User: { select: { fullName: true, Role: { select: { code: true } } } },
    },
  },
} as const satisfies Prisma.WeeklyMenuInclude;

type ListRow = Prisma.WeeklyMenuGetPayload<{ select: typeof listSelect }>;
type ListArguments = Pick<
  Prisma.WeeklyMenuFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof listSelect;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;
type Decision = "APPROVED" | "REVISION_REQUESTED";

const dayLabels = [
  "Chủ Nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.weeklyMenu.findMany(args);
};

const formatDate = (value: Date): string =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(value);

const formatDateTime = (value: Date | null): string | null =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(value)
    : null;

async function getApprovalDetail(menuId: string, principal?: AuthPrincipal) {
  const prisma = await getPrisma();
  const menu = await prisma.weeklyMenu.findFirst({
    where: { id: menuId, ...(principal ? listScopes.menu(principal) : {}) },
    include: approvalInclude,
  });
  if (!menu) return null;

  const defaultApprover = await prisma.user.findFirst({
    where: {
      schoolId: menu.schoolId,
      status: "ACTIVE",
      Role: { code: "SCHOOL_MANAGEMENT_BOARD" },
    },
    select: { fullName: true },
  });

  const healthReview = menu.menuReviewRecords.find(
    (review) => review.User.Role.code === "SCHOOL_HEALTH_OFFICER",
  );
  const boardReviews = menu.menuReviewRecords.filter(
    (review) => review.User.Role.code === "SCHOOL_MANAGEMENT_BOARD",
  );
  const reviewDto = (review: (typeof boardReviews)[number] | undefined) =>
    review
      ? {
          approver: review.User.fullName,
          role: "Ban Giám hiệu",
          note: review.feedback ?? "",
          reviewedAt: formatDateTime(review.reviewedAt),
        }
      : {
          approver: defaultApprover?.fullName ?? "Ban Giám hiệu",
          role: "Ban Giám hiệu",
          note: "",
          reviewedAt: null,
        };

  const days = menu.menuDays.map((day) => {
    const placements = day.menuDayDishes.map((placement) => {
      const suppliers = [
        ...new Set(
          placement.Dish.dishIngredientEntries.map(
            (link) => link.IngredientEntry.Ingredient.Supplier.name,
          ),
        ),
      ];

      return {
        mealType: placement.mealType,
        portionSize: placement.portionSize ? Number(placement.portionSize) : 0,
        item: {
          name: placement.Dish.name,
          description: placement.Dish.description,
          supplier: suppliers.join(", ") || null,
          tag: null,
          tone: "neutral",
        },
      };
    });
    const portions = placements.reduce(
      (largest, item) => Math.max(largest, item.portionSize),
      0,
    );

    return {
      id: day.id,
      status: day.approvalStatus,
      approval: reviewDto(
        boardReviews.find(
          (review) => review.menuDayId === day.id || review.menuDayId === null,
        ),
      ),
      shortLabel: dayLabels[day.menuDate.getUTCDay()],
      dayNumber: String(day.menuDate.getUTCDay() + 1),
      date: formatDate(day.menuDate),
      portions,
      lunch: placements
        .filter((item) => item.mealType === "LUNCH")
        .map((item) => item.item),
      snack: placements
        .filter((item) => item.mealType === "AFTERNOON")
        .map((item) => item.item),
    };
  });

  const supplierIds = new Set(
    menu.menuDays.flatMap((day) =>
      day.menuDayDishes.flatMap((placement) =>
        placement.Dish.dishIngredientEntries.map(
          (link) => link.IngredientEntry.Ingredient.Supplier.id,
        ),
      ),
    ),
  );
  const firstDate = menu.menuDays[0]?.menuDate ?? menu.weekStartDate;
  const lastDate = menu.menuDays.at(-1)?.menuDate ?? menu.weekStartDate;

  return {
    id: menu.id,
    code: menu.id,
    title: menu.title,
    description: null,
    status: menu.status,
    canDecide:
      menu.status !== "DRAFT" &&
      days.some((day) => day.status === "PENDING_APPROVAL"),
    submittedAt: formatDateTime(menu.submittedAt),
    summary: {
      audience: "Toàn trường",
      audienceDetail: "Số suất ăn được xác định theo kế hoạch phục vụ",
      servingPeriod: `${formatDate(firstDate)} - ${formatDate(lastDate)}`,
      servingDetail: `${days.length} ngày học bán trú`,
      proposer: "Bộ phận Bếp và Cán bộ Bán trú",
      proposerDetail: menu.School.name,
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
      role: "Cán bộ Y tế",
      reviewedAt: formatDateTime(healthReview?.reviewedAt ?? null) ?? "—",
      note: healthReview?.feedback ?? "Chưa có nhận xét thẩm định.",
      documents: [],
    },
    approval: reviewDto(boardReviews[0]),
  };
}

async function recordDecision(
  menuId: string,
  reviewerId: string | undefined,
  decision: Decision,
  feedback: string | undefined,
  menuDayId?: string,
) {
  const prisma = await getPrisma();
  return prisma.$transaction(async (transaction) => {
    // Serialize decisions for one week, including concurrent whole-week/day requests.
    await transaction.$queryRaw`SELECT id FROM foodprint.weekly_menus WHERE id = ${menuId}::uuid FOR UPDATE`;
    const menu = await transaction.weeklyMenu.findUnique({
      where: { id: menuId },
      select: {
        id: true,
        schoolId: true,
        status: true,
        menuDays: { select: { id: true, approvalStatus: true } },
      },
    });
    if (!menu) return null;
    if (menu.status === "DRAFT")
      throw new HttpError(409, "Thực đơn chưa được gửi duyệt");
    const targets = decisionTargets(menu.menuDays, menuDayId);

    let effectiveReviewerId = reviewerId;
    if (!effectiveReviewerId) {
      const reviewer = await transaction.user.findFirst({
        where: {
          schoolId: menu.schoolId,
          status: "ACTIVE",
          Role: { code: "SCHOOL_MANAGEMENT_BOARD" },
        },
        select: { id: true },
      });
      effectiveReviewerId = reviewer?.id;
    }
    if (!effectiveReviewerId) {
      throw new HttpError(
        422,
        "Chưa cấu hình tài khoản Ban Giám hiệu mặc định",
      );
    }
    const reviewer = await transaction.user.findFirst({
      where: {
        id: effectiveReviewerId,
        schoolId: menu.schoolId,
        status: "ACTIVE",
        Role: { code: "SCHOOL_MANAGEMENT_BOARD" },
      },
      select: { id: true },
    });
    if (!reviewer)
      throw new HttpError(
        403,
        "Người duyệt phải thuộc Ban Giám hiệu của trường",
      );
    const dayStatus =
      decision === "APPROVED" ? "APPROVED" : "REVISION_REQUIRED";
    const targetIds = new Set(targets.map((day) => day.id));
    await transaction.menuDay.updateMany({
      where: { id: { in: [...targetIds] }, weeklyMenuId: menu.id },
      data: { approvalStatus: dayStatus },
    });
    const status = aggregateDayStatus(
      menu.menuDays.map((day) =>
        targetIds.has(day.id) ? { ...day, approvalStatus: dayStatus } : day,
      ),
    );
    await transaction.weeklyMenu.update({
      where: { id: menu.id },
      data: {
        status,
        approvedAt: status === "APPROVED" ? new Date() : null,
      },
    });
    await transaction.menuReviewRecord.createMany({
      data: targets.map((day) => ({
        weeklyMenuId: menu.id,
        menuDayId: day.id,
        reviewerUserId: effectiveReviewerId,
        decision,
        feedback: feedback?.trim() || null,
      })),
    });

    return {
      id: menu.id,
      status,
      days: targets.map((day) => ({ id: day.id, status: dayStatus })),
    };
  });
}

export function createMenuService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["menu"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select: listSelect,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
    },
    getApprovalDetail,
    approveMenu(
      menuId: string,
      reviewerId: string | undefined,
      notes?: string,
      menuDayId?: string,
    ) {
      return recordDecision(menuId, reviewerId, "APPROVED", notes, menuDayId);
    },
    requestRevision(
      menuId: string,
      reviewerId: string | undefined,
      reason: string,
      menuDayId?: string,
    ) {
      return recordDecision(
        menuId,
        reviewerId,
        "REVISION_REQUESTED",
        reason,
        menuDayId,
      );
    },
  };
}

export const menuService = createMenuService();
export type MenuService = ReturnType<typeof createMenuService>;
