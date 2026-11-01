import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { withSchoolTransaction } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { readMealPortionDemand } from "../kitchen/kitchen.service";
import type { MealAllocationInput } from "./meal-allocation.validation";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  dailyMealPortionId: true,
  createdByUserId: true,
  status: true,
  allocatedAt: true,
  distributedAt: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.MealAllocationSelect;

type ListRow = Prisma.MealAllocationGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.MealAllocationFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.mealAllocation.findMany(args);
};

export function createMealAllocationService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  const detail = {
    DailyMealPortion: {
      select: {
        classId: true,
        mealDate: true,
        mealType: true,
        totalPortions: true,
        portionGroups: true,
      },
    },
    mealAllocationBatches: {
      select: {
        cookingBatchId: true,
        allocatedPortions: true,
        CookingBatch: {
          select: {
            menuDayId: true,
            dishId: true,
            mealType: true,
            status: true,
          },
        },
      },
    },
  } as const satisfies Prisma.MealAllocationInclude;
  return {
    async getOne(id: string, principal: AuthPrincipal) {
      const scope = listScopes["meal-allocation"](principal),
        db = await connect();
      const allocation = await db.mealAllocation.findFirst({
        where: { AND: [scope, { id }] },
        include: detail,
      });
      if (!allocation)
        throw new HttpError(404, "Không tìm thấy phân bổ suất ăn");
      return allocation;
    },
    async create(input: MealAllocationInput, principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_allocation.create",
        async (tx, actor, schoolId) => {
          const demand = await tx.dailyMealPortion.findFirst({
            where: { id: input.dailyMealPortionId, Class: { schoolId } },
            include: { dailyAllergyPortions: true, portionGroups: true },
          });
          if (!demand)
            throw new HttpError(404, "Không tìm thấy suất ăn của lớp");
          const day = await tx.menuDay.findFirst({
            where: {
              id: input.menuDayId,
              menuDate: demand.mealDate,
              WeeklyMenu: { schoolId },
            },
            select: { approvalStatus: true },
          });
          if (!day)
            throw new HttpError(404, "Ngày thực đơn không khớp lớp và bữa ăn");
          const existing = await tx.mealAllocation.findUnique({
            where: { dailyMealPortionId: demand.id },
            include: detail,
          });
          if (existing) {
            if (existing.status === "CANCELLED")
              throw new HttpError(
                409,
                "Phân bổ đã hủy; cần đối chiếu trước khi lập lại",
              );
            if (
              existing.mealAllocationBatches.some(
                (b) => b.CookingBatch.menuDayId !== input.menuDayId,
              )
            )
              throw new HttpError(
                409,
                "Lớp đã được phân bổ theo thực đơn khác",
              );
            return { ...existing, created: false };
          }
          if (
            demand.status !== "FINALIZED" ||
            day.approvalStatus !== "APPROVED"
          )
            throw new HttpError(
              409,
              "Cần suất ăn đã chốt và ngày thực đơn đã duyệt",
            );
          const meal = {
            menuDayId: input.menuDayId,
            mealType: demand.mealType,
          };
          const planned = await readMealPortionDemand(
            tx,
            meal,
            schoolId,
            demand.mealDate,
          );
          const needs = new Map(
            [...planned.dishPortions.keys()].map((id) => [
              id,
              planned.groups.length ? 0 : demand.totalPortions,
            ]),
          );
          for (const group of planned.groups) {
            const count = demand.portionGroups.find(
              (p) => p.portionGroupId === group.id,
            )!.portionCount;
            for (const dish of group.dishes)
              needs.set(dish.dishId, needs.get(dish.dishId)! + count);
          }
          if (!needs.size || demand.totalPortions <= 0)
            throw new HttpError(409, "Không có món hoặc số suất để phân bổ");
          const batches = await tx.cookingBatch.findMany({
            where: { ...meal, status: "COMPLETED" },
            select: {
              id: true,
              dishId: true,
              plannedPortions: true,
              cookingBatchLots: {
                select: {
                  IngredientLot: {
                    select: {
                      DeliveryItem: {
                        select: {
                          SupplyRequestItem: {
                            select: { ingredientEntryId: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            orderBy: [{ completedAt: "asc" }, { id: "asc" }],
          });
          const usage = await tx.mealAllocationBatch.groupBy({
            by: ["cookingBatchId"],
            where: { cookingBatchId: { in: batches.map((b) => b.id) } },
            _sum: { allocatedPortions: true },
          });
          const used = new Map(
            usage.map((b) => [b.cookingBatchId, b._sum.allocatedPortions ?? 0]),
          );
          const allergyIds = new Set(
            demand.dailyAllergyPortions
              .filter((a) => a.portionCount > 0)
              .map((a) => a.ingredientEntryId),
          );
          const rows: { cookingBatchId: string; allocatedPortions: number }[] =
            [];
          for (const [dishId, total] of needs) {
            let remaining = total;
            for (const batch of batches.filter((b) => b.dishId === dishId)) {
              if (!remaining) break;
              if (
                !planned.groups.length &&
                batch.cookingBatchLots.some((l) =>
                  allergyIds.has(
                    l.IngredientLot.DeliveryItem.SupplyRequestItem
                      .ingredientEntryId,
                  ),
                )
              )
                throw new HttpError(
                  422,
                  "Lớp có dị ứng với món; cần y tế thiết lập nhóm và món phù hợp",
                );
              const available =
                (batch.plannedPortions ?? 0) - (used.get(batch.id) ?? 0);
              if (available < 0)
                throw new HttpError(
                  409,
                  "Phân bổ cũ vượt số suất mẻ; cần đối chiếu lịch sử",
                );
              const count = Math.min(remaining, available);
              if (count > 0) {
                rows.push({
                  cookingBatchId: batch.id,
                  allocatedPortions: count,
                });
                remaining -= count;
              }
            }
            if (remaining > 0)
              throw new HttpError(
                409,
                "Chưa đủ mẻ hoàn thành cho từng món và nhóm suất của lớp",
              );
          }
          const allocation = await tx.mealAllocation.create({
            data: {
              dailyMealPortionId: demand.id,
              createdByUserId: actor.id,
              mealAllocationBatches: { create: rows },
            },
            include: detail,
          });
          return { ...allocation, created: true };
        },
      );
    },
    async distribute(id: string, principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_allocation.distribute",
        async (tx, actor, schoolId) => {
          const allocation = await tx.mealAllocation.findFirst({
            where: { id, DailyMealPortion: { Class: { schoolId } } },
            include: detail,
          });
          if (!allocation)
            throw new HttpError(
              404,
              "Không tìm thấy phân bổ suất ăn của trường",
            );
          if (allocation.status === "CANCELLED")
            throw new HttpError(409, "Không phân phối suất ăn đã hủy");
          if (allocation.status !== "ALLOCATED") return allocation;
          if (
            !allocation.mealAllocationBatches.length ||
            allocation.mealAllocationBatches.some(
              (b) => b.CookingBatch.status !== "COMPLETED",
            )
          )
            throw new HttpError(409, "Chưa có đủ mẻ hoàn thành để phân phối");
          return tx.mealAllocation.update({
            where: { id },
            data: {
              status: "DISTRIBUTED",
              distributedAt: new Date(),
              distributedByUserId: actor.id,
            },
            include: detail,
          });
        },
      );
    },
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["meal-allocation"](principal);
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

export const mealAllocationService = createMealAllocationService();
export type MealAllocationService = ReturnType<
  typeof createMealAllocationService
>;
