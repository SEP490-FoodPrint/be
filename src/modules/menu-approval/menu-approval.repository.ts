import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import type { MenuCalendarYear } from "../../utils/menu-week";

export const approvalDetailInclude = {
  grades: { select: { gradeId: true, grade: { select: { name: true } } } },
  School: { select: { name: true } },
  User: { select: { fullName: true } },
  menuDays: {
    orderBy: { menuDate: "asc" as const },
    include: {
      menuDayDishes: {
        orderBy: { displayOrder: "asc" as const },
        include: {
          ingredients: {
            include: {
              ingredient: {
                include: { Supplier: { select: { id: true, name: true } } },
              },
            },
          },
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

export type ApprovalDetailRow = Prisma.WeeklyMenuGetPayload<{
  include: typeof approvalDetailInclude;
}>;

export const approvalDecisionInclude = {
  menuDays: {
    include: {
      menuDayDishes: {
        include: {
          ingredients: true,
          Dish: { select: { status: true } },
        },
      },
    },
  },
} as const satisfies Prisma.WeeklyMenuInclude;

export type ApprovalDecisionRow = Prisma.WeeklyMenuGetPayload<{
  include: typeof approvalDecisionInclude;
}>;

export interface SubmittedWeekRow {
  weekStartDate: Date;
  status: "DRAFT" | "PENDING_APPROVAL" | "REVISION_REQUIRED" | "APPROVED";
  count: number;
}

type TransactionClient = Prisma.TransactionClient;

export interface MenuApprovalRepository {
  connect(): Promise<PrismaClient>;
  academicYears(
    tx: TransactionClient,
    schoolId: string,
  ): Promise<MenuCalendarYear[]>;
  /** Mọi thực đơn đã gửi (khác DRAFT) của một tuần. */
  findWeekDetails(
    scope: Prisma.WeeklyMenuWhereInput,
    weekStartDate: Date,
  ): Promise<ApprovalDetailRow[]>;
  /** Số thực đơn đã gửi theo từng tuần và trạng thái. */
  listSubmittedWeeks(
    scope: Prisma.WeeklyMenuWhereInput,
  ): Promise<SubmittedWeekRow[]>;
  /**
   * Số suất lớp đăng ký ăn bán trú (UC-19-1): tổng `registeredMealPortions`
   * của lớp đang hoạt động, lọc theo khối khi thực đơn áp cho khối.
   */
  findRegisteredPortions(
    schoolId: string,
    gradeIds?: string[],
  ): Promise<number>;
  findForDecision(
    tx: TransactionClient,
    id: string,
    schoolId: string,
  ): Promise<ApprovalDecisionRow | null>;
  createReview(
    tx: TransactionClient,
    input: {
      weeklyMenuId: string;
      reviewerUserId: string;
      decision: "APPROVED" | "REVISION_REQUESTED";
      feedback: string | null;
    },
  ): Promise<{
    reviewedAt: Date;
    User: { id: string; fullName: string };
  }>;
  updateAllDays(
    tx: TransactionClient,
    weeklyMenuId: string,
    status: "APPROVED" | "REVISION_REQUIRED",
  ): Promise<void>;
  updateWeek(
    tx: TransactionClient,
    weeklyMenuId: string,
    status: "APPROVED" | "REVISION_REQUIRED",
    approvedAt: Date | null,
  ): Promise<void>;
}

export function createMenuApprovalRepository(
  getClient: () => Promise<PrismaClient> = getPrisma,
): MenuApprovalRepository {
  return {
    connect: getClient,

    academicYears(tx, schoolId) {
      return tx.schoolAcademicYear.findMany({
        where: { schoolId },
        select: { startDate: true, endDate: true, holidays: true },
      });
    },

    async findWeekDetails(scope, weekStartDate) {
      const prisma = await getClient();
      return prisma.weeklyMenu.findMany({
        where: {
          AND: [scope, { weekStartDate, status: { not: "DRAFT" } }],
        },
        include: approvalDetailInclude,
        orderBy: [{ isSchoolWide: "desc" }, { createdAt: "asc" }],
      });
    },

    async listSubmittedWeeks(scope) {
      const prisma = await getClient();
      const rows = await prisma.weeklyMenu.groupBy({
        by: ["weekStartDate", "status"],
        where: { AND: [scope, { status: { not: "DRAFT" } }] },
        _count: { _all: true },
      });
      return rows.map((row) => ({
        weekStartDate: row.weekStartDate,
        status: row.status,
        count: row._count._all,
      }));
    },

    async findRegisteredPortions(schoolId, gradeIds = []) {
      const prisma = await getClient();
      const result = await prisma.class.aggregate({
        where: {
          schoolId,
          status: "ACTIVE",
          ...(gradeIds.length ? { gradeId: { in: gradeIds } } : {}),
        },
        _sum: { registeredMealPortions: true },
      });
      return result._sum.registeredMealPortions ?? 0;
    },

    findForDecision(tx, id, schoolId) {
      return tx.weeklyMenu.findFirst({
        where: { id, schoolId },
        include: approvalDecisionInclude,
      });
    },

    createReview(tx, input) {
      return tx.menuReviewRecord.create({
        data: { ...input, menuDayId: null },
        select: {
          reviewedAt: true,
          User: { select: { id: true, fullName: true } },
        },
      });
    },

    async updateAllDays(tx, weeklyMenuId, status) {
      await tx.menuDay.updateMany({
        where: { weeklyMenuId },
        data: { approvalStatus: status },
      });
    },

    async updateWeek(tx, weeklyMenuId, status, approvedAt) {
      await tx.weeklyMenu.update({
        where: { id: weeklyMenuId },
        data: { status, approvedAt },
      });
    },
  };
}

export const menuApprovalRepository = createMenuApprovalRepository();
