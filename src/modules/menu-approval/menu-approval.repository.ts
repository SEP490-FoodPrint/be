import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

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

export interface FinalizedPortionRow {
  mealDate: Date;
  mealType: "LUNCH" | "AFTERNOON";
  totalPortions: number;
}

export interface GradeCoverageRow {
  grades: { id: string; name: string; activeClasses: number }[];
  unassignedActiveClasses: number;
  /** Suất FINALIZED theo khối, ngày và bữa; gradeId null = lớp chưa gán khối. */
  portions: {
    gradeId: string | null;
    mealDate: Date;
    mealType: "LUNCH" | "AFTERNOON";
    totalPortions: number;
  }[];
  /** Khối đã thuộc một thực đơn khác của cùng tuần. */
  otherMenuGradeIds: string[];
  hasOtherSchoolWideMenu: boolean;
}

type TransactionClient = Prisma.TransactionClient;

export interface MenuApprovalRepository {
  connect(): Promise<PrismaClient>;
  findDetail(id: string, schoolId: string): Promise<ApprovalDetailRow | null>;
  findFinalizedPortions(
    dates: Date[],
    schoolId: string,
    gradeIds?: string[],
  ): Promise<FinalizedPortionRow[]>;
  findGradeCoverage(input: {
    schoolId: string;
    weeklyMenuId: string;
    weekStartDate: Date;
    academicYear: string;
    dates: Date[];
  }): Promise<GradeCoverageRow>;
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

    async findDetail(id, schoolId) {
      const prisma = await getClient();
      return prisma.weeklyMenu.findFirst({
        where: { id, schoolId },
        include: approvalDetailInclude,
      });
    },

    async findFinalizedPortions(dates, schoolId, gradeIds = []) {
      if (!dates.length) return [];
      const prisma = await getClient();
      const rows = await prisma.dailyMealPortion.groupBy({
        by: ["mealDate", "mealType"],
        where: {
          mealDate: { in: dates },
          status: "FINALIZED",
          Class: {
            schoolId,
            ...(gradeIds.length ? { gradeId: { in: gradeIds } } : {}),
          },
        },
        _sum: { totalPortions: true },
      });
      return rows.map((row) => ({
        mealDate: row.mealDate,
        mealType: row.mealType,
        totalPortions: row._sum.totalPortions ?? 0,
      }));
    },

    async findGradeCoverage({
      schoolId,
      weeklyMenuId,
      weekStartDate,
      academicYear,
      dates,
    }) {
      const prisma = await getClient();
      const activeClass = {
        schoolId,
        status: "ACTIVE" as const,
        academicYear,
      };
      const [grades, unassignedActiveClasses, portionRows, otherGrades, other] =
        await Promise.all([
          prisma.schoolGrade.findMany({
            where: { schoolId },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              _count: { select: { classes: { where: activeClass } } },
            },
          }),
          prisma.class.count({ where: { ...activeClass, gradeId: null } }),
          dates.length
            ? prisma.dailyMealPortion.findMany({
                where: {
                  mealDate: { in: dates },
                  status: "FINALIZED",
                  Class: { schoolId },
                },
                select: {
                  mealDate: true,
                  mealType: true,
                  totalPortions: true,
                  Class: { select: { gradeId: true } },
                },
              })
            : Promise.resolve([]),
          prisma.weeklyMenuGrade.findMany({
            where: {
              schoolId,
              weekStartDate,
              weeklyMenuId: { not: weeklyMenuId },
            },
            select: { gradeId: true },
          }),
          prisma.weeklyMenu.count({
            where: {
              schoolId,
              weekStartDate,
              isSchoolWide: true,
              id: { not: weeklyMenuId },
            },
          }),
        ]);
      return {
        grades: grades.map((grade) => ({
          id: grade.id,
          name: grade.name,
          activeClasses: grade._count.classes,
        })),
        unassignedActiveClasses,
        portions: portionRows.map((row) => ({
          gradeId: row.Class.gradeId,
          mealDate: row.mealDate,
          mealType: row.mealType,
          totalPortions: row.totalPortions,
        })),
        otherMenuGradeIds: otherGrades.map((row) => row.gradeId),
        hasOtherSchoolWideMenu: other > 0,
      };
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
