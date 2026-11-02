import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import type {
  MealSummaryQuery,
  DailyPortionGroupsInput,
} from "./meal-attendance.validation";
import { assertPortionGroupSafety } from "../kitchen/kitchen.service";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  classId: true,
  confirmedByUserId: true,
  mealDate: true,
  mealType: true,
  totalPortions: true,
  status: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DailyMealPortionSelect;

type ListRow = Prisma.DailyMealPortionGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.DailyMealPortionFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.dailyMealPortion.findMany(args);
};

export function createMealAttendanceService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  async function owned(
    db: Prisma.TransactionClient,
    id: string,
    principal: AuthPrincipal,
  ) {
    if (principal.orgType !== "SCHOOL" || !principal.schoolId)
      throw new HttpError(403, "Cần phạm vi trường");
    const demand = await db.dailyMealPortion.findFirst({
      where: { id, Class: { schoolId: principal.schoolId } },
      include: { portionGroups: true, dailyAllergyPortions: true },
    });
    if (!demand) throw new HttpError(404, "Không tìm thấy suất ăn của lớp");
    if (
      principal.role === "HOMEROOM_TEACHER" &&
      demand.confirmedByUserId !== principal.id
    )
      throw new HttpError(403, "GVCN chỉ được thao tác suất ăn do mình chốt");
    return demand;
  }
  return {
    async getPortionGroups(id: string, principal: AuthPrincipal) {
      assertPermission(principal, "daily_meal_portion.view");
      const db = await connect(),
        demand = await owned(db, id, principal);
      const groups = await db.menuMealPortionGroup.findMany({
        where: {
          menuDay: {
            menuDate: demand.mealDate,
            WeeklyMenu: { schoolId: principal.schoolId! },
          },
          mealType: demand.mealType,
        },
        include: {
          dishes: { select: { dishId: true } },
          avoidances: { select: { ingredientEntryId: true } },
        },
        orderBy: { id: "asc" },
      });
      return {
        dailyMealPortionId: id,
        totalPortions: demand.totalPortions,
        groups,
        counts: demand.portionGroups,
        dailyAllergyPortions: demand.dailyAllergyPortions,
      };
    },
    async savePortionGroups(
      id: string,
      input: DailyPortionGroupsInput,
      principal: AuthPrincipal,
    ) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "daily_meal_portion.update",
        async (tx, actor, schoolId) => {
          if (actor.role !== "HOMEROOM_TEACHER")
            throw new HttpError(403, "Chỉ GVCN chốt số suất nhóm của lớp");
          const demand = await owned(tx, id, actor);
          if (demand.status !== "FINALIZED")
            throw new HttpError(409, "Cần chốt tổng số suất của lớp trước");
          const meal = {
            menuDayId: input.menuDayId,
            mealType: demand.mealType,
          };
          const day = await tx.menuDay.findFirst({
            where: {
              id: input.menuDayId,
              menuDate: demand.mealDate,
              WeeklyMenu: { schoolId },
            },
            select: { approvalStatus: true },
          });
          if (!day)
            throw new HttpError(
              404,
              "Ngày thực đơn không khớp suất ăn của lớp",
            );
          if (day.approvalStatus !== "APPROVED")
            throw new HttpError(
              409,
              "Chỉ chốt nhóm suất cho ngày thực đơn đã duyệt",
            );
          const groups = await assertPortionGroupSafety(tx, meal, schoolId);
          if (
            groups.length !== input.groups.length ||
            groups.some(
              (g) => !input.groups.some((i) => i.portionGroupId === g.id),
            ) ||
            input.groups.reduce((n, g) => n + g.portionCount, 0) !==
              demand.totalPortions
          )
            throw new HttpError(
              422,
              "Các nhóm phải đầy đủ, không trùng và cộng đúng tổng số suất lớp",
            );
          if (
            demand.portionGroups.some(
              (g) => !groups.some((i) => i.id === g.portionGroupId),
            )
          )
            throw new HttpError(
              409,
              "Suất ăn đã được chốt cho thực đơn khác; không ghi đè",
            );
          const avoidedCounts = new Map<string, number>();
          for (const group of groups)
            for (const avoid of group.avoidances)
              avoidedCounts.set(
                avoid.ingredientEntryId,
                (avoidedCounts.get(avoid.ingredientEntryId) ?? 0) +
                  input.groups.find((g) => g.portionGroupId === group.id)!
                    .portionCount,
              );
          if (
            demand.dailyAllergyPortions.some(
              (a) =>
                (avoidedCounts.get(a.ingredientEntryId) ?? 0) !==
                a.portionCount,
            )
          )
            throw new HttpError(
              422,
              "Nhóm suất khác số suất dị ứng đã chốt; cần đối chiếu, không tự ghi đè",
            );
          const master = await tx.classAllergy.findMany({
            where: { classId: demand.classId },
            select: { ingredientEntryId: true, affectedCount: true },
          });
          for (const [entryId, count] of avoidedCounts)
            if (
              count > 0 &&
              !master.some(
                (a) =>
                  a.ingredientEntryId === entryId && count <= a.affectedCount,
              )
            )
              throw new HttpError(
                422,
                "Số suất nhóm vượt thông tin dị ứng của lớp; cần y tế đối chiếu",
              );
          const unchanged =
            demand.portionGroups.length === groups.length &&
            input.groups.every((g) =>
              demand.portionGroups.some(
                (p) =>
                  p.portionGroupId === g.portionGroupId &&
                  p.portionCount === g.portionCount,
              ),
            );
          if (unchanged)
            return {
              dailyMealPortionId: id,
              groups: demand.portionGroups,
              unchanged: true,
            };
          if (
            (await tx.cookingBatch.count({ where: meal })) ||
            (await tx.menuMealSeasoningLot.count({ where: meal })) ||
            (await tx.mealAllocation.count({
              where: { dailyMealPortionId: id },
            }))
          )
            throw new HttpError(
              409,
              "Đã lập mẻ hoặc phân phối; không thay đổi nhóm suất",
            );
          for (const [entryId, count] of avoidedCounts)
            if (
              count > 0 &&
              !demand.dailyAllergyPortions.some(
                (a) => a.ingredientEntryId === entryId,
              )
            )
              await tx.dailyAllergyPortion.create({
                data: {
                  dailyMealPortionId: id,
                  classId: demand.classId,
                  ingredientEntryId: entryId,
                  portionCount: count,
                },
              });
          const now = new Date();
          for (const group of input.groups)
            await tx.dailyMealPortionGroup.upsert({
              where: {
                dailyMealPortionId_portionGroupId: {
                  dailyMealPortionId: id,
                  portionGroupId: group.portionGroupId,
                },
              },
              create: {
                dailyMealPortionId: id,
                ...group,
                confirmedByUserId: actor.id,
                confirmedAt: now,
              },
              update: {
                portionCount: group.portionCount,
                confirmedByUserId: actor.id,
                confirmedAt: now,
              },
            });
          return {
            dailyMealPortionId: id,
            groups: await tx.dailyMealPortionGroup.findMany({
              where: { dailyMealPortionId: id },
              orderBy: { portionGroupId: "asc" },
            }),
            unchanged: false,
          };
        },
      );
    },
    async summary(query: MealSummaryQuery, principal: AuthPrincipal) {
      assertPermission(
        principal,
        "daily_meal_portion.view",
        "cooking_batch.view",
        "menu.view",
      );
      if (principal.orgType !== "SCHOOL" || !principal.schoolId)
        throw new HttpError(403, "Cần phạm vi trường");
      const db = await connect();
      return db.$transaction(
        async (tx) => {
          const where = {
            mealDate: query.date,
            mealType: query.mealType,
            Class: { schoolId: principal.schoolId! },
          };
          const demand = await tx.dailyMealPortion.aggregate({
            where: { ...where, status: "FINALIZED" },
            _sum: { totalPortions: true },
            _count: true,
          });
          const pending = await tx.dailyMealPortion.count({
            where: { ...where, status: "DRAFT" },
          });
          return {
            date: query.date.toISOString().slice(0, 10),
            mealType: query.mealType,
            totalPortions: demand._sum.totalPortions ?? 0,
            finalizedClasses: demand._count,
            pendingClasses: pending,
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    },
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["meal-attendance"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
    },
  };
}

export const mealAttendanceService = createMealAttendanceService();
export type MealAttendanceService = ReturnType<
  typeof createMealAttendanceService
>;
