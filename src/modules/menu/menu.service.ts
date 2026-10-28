import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
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
                          Supplier: { select: { name: true } },
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
    include: { User: { select: { fullName: true } } },
  },
} as const satisfies Prisma.WeeklyMenuInclude;

type ListRow = Prisma.WeeklyMenuGetPayload<{ select: typeof listSelect }>;
type ListArguments = Pick<
  Prisma.WeeklyMenuFindManyArgs,
  "skip" | "take" | "orderBy"
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

async function getApprovalDetail(menuId: string) {
  const prisma = await getPrisma();
  const menu = await prisma.weeklyMenu.findUnique({
    where: { id: menuId },
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

  const days = menu.menuDays.map((day, index) => {
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
      shortLabel: dayLabels[day.menuDate.getUTCDay()],
      dayNumber: String(index + 1),
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

  const latestReview = menu.menuReviewRecords[0];
  const supplier = days
    .flatMap((day) => [...day.lunch, ...day.snack])
    .find((item) => item.supplier)?.supplier;
  const firstDate = menu.menuDays[0]?.menuDate ?? menu.weekStartDate;
  const lastDate = menu.menuDays.at(-1)?.menuDate ?? menu.weekStartDate;

  return {
    id: menu.id,
    code: menu.id,
    title: menu.title,
    description: null,
    status: menu.status,
    submittedAt: formatDateTime(menu.submittedAt),
    summary: {
      audience: "Toàn trường",
      audienceDetail: "Số suất ăn được xác định theo kế hoạch phục vụ",
      servingPeriod: `${formatDate(firstDate)} - ${formatDate(lastDate)}`,
      servingDetail: `${days.length} ngày học bán trú`,
      proposer: "Bộ phận Bếp và Cán bộ Bán trú",
      proposerDetail: menu.School.name,
      supplier: supplier ?? "Nhiều nhà cung cấp đã phê duyệt",
      supplierDetail: "Đối chiếu theo nguyên liệu của từng món",
    },
    compliance: [],
    days,
    medicalReview: {
      status: latestReview ? "Đã thẩm định" : "Chưa thẩm định",
      reviewer: latestReview?.User.fullName ?? "Chưa phân công",
      role: "Cán bộ Y tế",
      reviewedAt: formatDateTime(latestReview?.reviewedAt ?? null) ?? "—",
      note: latestReview?.feedback ?? "Chưa có nhận xét thẩm định.",
      documents: [],
    },
    approval: {
      approver:
        latestReview?.User.fullName ??
        defaultApprover?.fullName ??
        "Ban Giám hiệu",
      role: "Ban Giám hiệu",
    },
  };
}

async function recordDecision(
  menuId: string,
  reviewerId: string | undefined,
  decision: Decision,
  feedback: string | undefined,
) {
  const prisma = await getPrisma();
  return prisma.$transaction(async (transaction) => {
    const menu = await transaction.weeklyMenu.findUnique({
      where: { id: menuId },
      select: { id: true, schoolId: true },
    });
    if (!menu) return null;

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

    const status = decision === "APPROVED" ? "APPROVED" : "REVISION_REQUIRED";
    await transaction.weeklyMenu.update({
      where: { id: menu.id },
      data: {
        status,
        approvedAt: decision === "APPROVED" ? new Date() : null,
      },
    });
    const review = await transaction.menuReviewRecord.create({
      data: {
        weeklyMenuId: menu.id,
        reviewerUserId: effectiveReviewerId,
        decision,
        feedback: feedback?.trim() || null,
      },
      select: { id: true },
    });

    return { id: menu.id, status, reviewId: review.id };
  });
}

export function createMenuService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () =>
          read({
            ...listWindow(query),
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
    ) {
      return recordDecision(menuId, reviewerId, "APPROVED", notes);
    },
    requestRevision(
      menuId: string,
      reviewerId: string | undefined,
      reason: string,
    ) {
      return recordDecision(menuId, reviewerId, "REVISION_REQUESTED", reason);
    },
  };
}

export const menuService = createMenuService();
export type MenuService = ReturnType<typeof createMenuService>;
