import type { Prisma, PrismaClient } from "../../generated/prisma/client";
type Db = PrismaClient | Prisma.TransactionClient;

export const complaintInclude = {
  submittedByUser: { select: { id: true, fullName: true } },
  handledByUser: { select: { id: true, fullName: true } },
  MealAllocation: {
    select: {
      id: true,
      status: true,
      DailyMealPortion: {
        select: {
          mealDate: true,
          mealType: true,
          Class: {
            select: {
              id: true,
              name: true,
              academicYear: true,
              schoolId: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.MealComplaintInclude;
export type ComplaintRow = Prisma.MealComplaintGetPayload<{
  include: typeof complaintInclude;
}>;

export function createFeedbackRepository() {
  return {
    list(
      db: Db,
      scope: Prisma.MealComplaintWhereInput,
      query: import("./feedback.request.dto").ComplaintListQueryDTO,
    ) {
      const from = query.from
        ? new Date(`${query.from}T00:00:00.000Z`)
        : undefined;
      const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      const where: Prisma.MealComplaintWhereInput = {
        AND: [
          scope,
          query.status ? { status: query.status } : {},
          query.complaintType ? { complaintType: query.complaintType } : {},
          from || to ? { submittedAt: { gte: from, lte: to } } : {},
          query.search
            ? {
                OR: [
                  {
                    description: {
                      contains: query.search,
                      mode: "insensitive",
                    },
                  },
                  {
                    submittedByUser: {
                      fullName: { contains: query.search, mode: "insensitive" },
                    },
                  },
                  {
                    MealAllocation: {
                      DailyMealPortion: {
                        Class: {
                          name: { contains: query.search, mode: "insensitive" },
                        },
                      },
                    },
                  },
                ],
              }
            : {},
        ],
      };
      const skip = (query.page - 1) * query.limit;
      const take = query.limit + 1;
      return db.mealComplaint.findMany({
        where,
        skip,
        take,
        include: complaintInclude,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      });
    },
    findOne(db: Db, scope: Prisma.MealComplaintWhereInput, id: string) {
      return db.mealComplaint.findFirst({
        where: { AND: [scope, { id }] },
        include: complaintInclude,
      });
    },
    findAllocation(
      db: Db,
      id: string,
      schoolId: string,
      teacherUserId: string,
    ) {
      return db.mealAllocation.findFirst({
        where: {
          id,
          status: { in: ["DISTRIBUTED", "FINALIZED"] },
          DailyMealPortion: { Class: { schoolId } },
        },
        select: {
          id: true,
          DailyMealPortion: {
            select: {
              mealDate: true,
              Class: {
                select: {
                  homeroomAssignments: {
                    where: { teacherUserId },
                    select: { assignedAt: true, endedAt: true },
                  },
                },
              },
            },
          },
        },
      });
    },
    create(
      db: Db,
      data: {
        mealAllocationId: string;
        submittedByUserId: string;
        complaintType: CreateDataType;
        description: string;
      },
    ) {
      return db.mealComplaint.create({
        data: { ...data, status: "SUBMITTED" },
        include: complaintInclude,
      });
    },
    updateStatus(
      db: Db,
      id: string,
      data: {
        status: "IN_REVIEW" | "RESOLVED";
        handledByUserId: string;
        resolution?: string;
        resolvedAt?: Date;
      },
    ) {
      return db.mealComplaint.update({
        where: { id },
        data,
        include: complaintInclude,
      });
    },
  };
}
type CreateDataType =
  "MEAL_QUALITY" | "FOOD_HYGIENE" | "HEALTH_ISSUE" | "OTHER";
export type FeedbackRepository = ReturnType<typeof createFeedbackRepository>;
