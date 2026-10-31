import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { assertPermission, loadPrincipal } from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  convertQuantity,
  planCookingBatches,
  type PlanningLot,
} from "./kitchen.planner";
import type { validateKitchenPlan } from "./kitchen.validation";

const detailSelect = {
  id: true,
  batchCode: true,
  menuDayId: true,
  dishId: true,
  mealType: true,
  cookingModeApplied: true,
  status: true,
  plannedPortions: true,
  confirmedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  cookingBatchLots: {
    select: { ingredientLotId: true, quantityUsed: true, unit: true },
    orderBy: { ingredientLotId: "asc" },
  },
} as const satisfies Prisma.CookingBatchSelect;
type Detail = Prisma.CookingBatchGetPayload<{ select: typeof detailSelect }>;
type Tx = Prisma.TransactionClient;
type PlanInput = ReturnType<typeof validateKitchenPlan>;

function dto(batch: Detail) {
  return {
    ...batch,
    cookingBatchLots: batch.cookingBatchLots.map((lot) => ({
      ingredientLotId: lot.ingredientLotId,
      quantityUsed: lot.quantityUsed.toString(),
      unit: lot.unit,
    })),
  };
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta = error.meta;
  return (
    !!meta &&
    typeof meta === "object" &&
    "code" in meta &&
    (meta.code === "40001" || meta.code === "40P01")
  );
}

/** All kitchen writes lock the trusted school first, then batch/lots by UUID. */
export function createKitchenLifecycle(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  async function write<T>(
    principal: AuthPrincipal,
    permission: string,
    operation: (tx: Tx, actor: AuthPrincipal, schoolId: string) => Promise<T>,
  ): Promise<T> {
    assertPermission(principal, permission);
    if (principal.orgType !== "SCHOOL" || !principal.schoolId)
      throw new HttpError(
        403,
        "Thao tác chế biến yêu cầu phạm vi trường đã xác thực",
      );
    const db = await connect();
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(
          async (tx) => {
            const actor = await loadPrincipal(principal.id, tx);
            assertPermission(actor, permission);
            if (
              actor.orgType !== "SCHOOL" ||
              !actor.schoolId ||
              actor.schoolId !== principal.schoolId
            )
              throw new HttpError(
                403,
                "Phạm vi tài khoản đã thay đổi; vui lòng tải lại",
              );
            await tx.$queryRaw`SELECT id FROM foodprint.schools WHERE id = ${actor.schoolId}::uuid FOR UPDATE`;
            const school = await tx.school.findUnique({
              where: { id: actor.schoolId },
              select: { status: true },
            });
            if (school?.status !== "ACTIVE")
              throw new HttpError(409, "Trường không còn hoạt động");
            return operation(tx, actor, actor.schoolId);
          },
          { isolationLevel: "Serializable", maxWait: 10000, timeout: 20000 },
        );
      } catch (error) {
        if (attempt < 2 && retryable(error)) continue;
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          "Chưa thể xử lý mẻ chế biến; vui lòng thử lại",
        );
      }
    }
  }

  async function lockedBatch(
    tx: Tx,
    id: string,
    schoolId: string,
  ): Promise<Detail> {
    const where = { id, MenuDay: { WeeklyMenu: { schoolId } } };
    if (!(await tx.cookingBatch.findFirst({ where, select: { id: true } })))
      throw new HttpError(404, "Không tìm thấy mẻ chế biến trong trường");
    await tx.$queryRaw`SELECT id FROM foodprint.cooking_batches WHERE id = ${id}::uuid FOR UPDATE`;
    const batch = await tx.cookingBatch.findFirst({
      where,
      select: detailSelect,
    });
    if (!batch) throw new HttpError(404, "Không tìm thấy mẻ chế biến");
    return batch;
  }

  async function reservations(tx: Tx, lots: { id: string; unit: string }[]) {
    const totals = new Map(lots.map((lot) => [lot.id, new Prisma.Decimal(0)]));
    const byId = new Map(lots.map((lot) => [lot.id, lot]));
    if (!lots.length) return totals;
    const rows = await tx.cookingBatchLot.findMany({
      where: {
        ingredientLotId: { in: lots.map((lot) => lot.id) },
        CookingBatch: { status: { in: ["UNCONFIRMED", "CONFIRMED"] } },
      },
      select: { ingredientLotId: true, quantityUsed: true, unit: true },
    });
    for (const row of rows) {
      const lot = byId.get(row.ingredientLotId);
      if (!lot || !row.quantityUsed.gt(0))
        throw new HttpError(409, "Lượng giữ nguyên liệu không hợp lệ");
      totals.set(
        lot.id,
        totals
          .get(lot.id)!
          .add(convertQuantity(row.quantityUsed, row.unit, lot.unit)),
      );
    }
    return totals;
  }

  async function lockLots(tx: Tx, ids: string[]) {
    for (const id of [...new Set(ids)].sort())
      await tx.$queryRaw`SELECT id FROM foodprint.ingredient_lots WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async function checkReservedStock(tx: Tx, batch: Detail, schoolId: string) {
    if (
      !batch.plannedPortions ||
      batch.plannedPortions <= 0 ||
      !batch.cookingBatchLots.length
    )
      throw new HttpError(
        409,
        "Mẻ chưa có kế hoạch số suất/nguyên liệu hợp lệ",
      );
    const lots = await tx.ingredientLot.findMany({
      where: {
        id: { in: batch.cookingBatchLots.map((lot) => lot.ingredientLotId) },
        DeliveryItem: {
          Delivery: { status: "RECEIVED", SupplyRequest: { schoolId } },
        },
      },
      select: { id: true, unit: true, availableQuantity: true, status: true },
    });
    if (lots.length !== batch.cookingBatchLots.length)
      throw new HttpError(
        409,
        "Thiếu lô nguyên liệu hợp lệ trong phạm vi trường",
      );
    await lockLots(
      tx,
      lots.map((lot) => lot.id),
    );
    const reserved = await reservations(tx, lots);
    for (const lot of lots) {
      if (
        lot.status !== "AVAILABLE" ||
        lot.availableQuantity.lt(reserved.get(lot.id)!)
      )
        throw new HttpError(
          409,
          "Tồn kho không đủ cho các mẻ đang giữ nguyên liệu; cần đối chiếu",
        );
    }
    return new Map(lots.map((lot) => [lot.id, lot]));
  }

  return {
    async getOne(id: string, principal: AuthPrincipal) {
      const where = listScopes.kitchen(principal);
      const db = await connect();
      const batch = await db.cookingBatch.findFirst({
        where: { AND: [where, { id }] },
        select: detailSelect,
      });
      if (!batch) throw new HttpError(404, "Không tìm thấy mẻ chế biến");
      return dto(batch);
    },

    plan(input: PlanInput, principal: AuthPrincipal) {
      return write(
        principal,
        "cooking_batch.create",
        async (tx, actor, schoolId) => {
          const school = await tx.school.findUniqueOrThrow({
            where: { id: schoolId },
            select: {
              cookingMode: true,
              lunchTime: true,
              afternoonMealTime: true,
            },
          });
          if (
            !school.cookingMode ||
            !(input.mealType === "LUNCH"
              ? school.lunchTime
              : school.afternoonMealTime)
          )
            throw new HttpError(
              409,
              "BGH cần cấu hình chế độ nấu và giờ phục vụ trước",
            );
          const menu = await tx.menuDayDish.findUnique({
            where: { menuDayId_dishId_mealType: input },
            select: {
              MenuDay: {
                select: {
                  menuDate: true,
                  WeeklyMenu: { select: { schoolId: true, status: true } },
                },
              },
              Dish: { select: { schoolId: true, status: true } },
            },
          });
          if (
            !menu ||
            menu.MenuDay.WeeklyMenu.schoolId !== schoolId ||
            menu.Dish.schoolId !== schoolId
          )
            throw new HttpError(
              404,
              "Không tìm thấy món trong thực đơn của trường",
            );
          if (
            menu.MenuDay.WeeklyMenu.status !== "APPROVED" ||
            menu.Dish.status !== "ACTIVE"
          )
            throw new HttpError(
              409,
              "Chỉ lập mẻ cho thực đơn đã duyệt và món đang hoạt động",
            );
          const demandWhere = {
            mealDate: menu.MenuDay.menuDate,
            mealType: input.mealType,
            status: "FINALIZED" as const,
            Class: { schoolId },
          };
          const demand = await tx.dailyMealPortion.aggregate({
            where: demandWhere,
            _sum: { totalPortions: true },
          });
          const portions = demand._sum.totalPortions ?? 0;
          if (
            !Number.isSafeInteger(portions) ||
            portions <= 0 ||
            portions > 2147483647
          )
            throw new HttpError(
              409,
              "Chưa có nhu cầu suất ăn hợp lệ đã chốt cho bữa này",
            );
          const existing = await tx.cookingBatch.findMany({
            where: input,
            select: detailSelect,
            orderBy: { id: "asc" },
          });
          if (
            existing.some(
              (batch) => !batch.plannedPortions || batch.plannedPortions <= 0,
            )
          )
            throw new HttpError(
              409,
              "Mẻ cũ thiếu số suất kế hoạch; cần đối chiếu trước",
            );
          const planned = existing.reduce(
            (sum, batch) => sum + batch.plannedPortions!,
            0,
          );
          if (planned > portions)
            throw new HttpError(
              409,
              "Kế hoạch cũ vượt nhu cầu hiện tại; không tự thay đổi lịch sử",
            );
          if (planned === portions)
            return { created: false, batches: existing.map(dto) };

          const recipe = await tx.dishIngredientEntry.findMany({
            where: { dishId: input.dishId },
            select: {
              ingredientEntryId: true,
              requiredQuantity: true,
              unit: true,
              IngredientEntry: { select: { schoolId: true } },
            },
            orderBy: { ingredientEntryId: "asc" },
          });
          if (
            !recipe.length ||
            recipe.some((row) => row.IngredientEntry.schoolId !== schoolId)
          )
            throw new HttpError(409, "Recipe chưa hợp lệ trong phạm vi trường");
          const entryIds = recipe.map((row) => row.ingredientEntryId);
          if (
            await tx.dailyAllergyPortion.findFirst({
              where: {
                DailyMealPortion: demandWhere,
                ingredientEntryId: { in: entryIds },
                portionCount: { gt: 0 },
              },
              select: { dailyMealPortionId: true },
            })
          )
            throw new HttpError(
              409,
              "Nhu cầu có dị ứng liên quan recipe; cần phương án món phù hợp trước khi lập mẻ",
            );
          const lotWhere: Prisma.IngredientLotWhereInput = {
            status: "AVAILABLE",
            availableQuantity: { gt: 0 },
            OR: [
              { expiryDate: null },
              { expiryDate: { gte: menu.MenuDay.menuDate } },
            ],
            DeliveryItem: {
              Delivery: { status: "RECEIVED", SupplyRequest: { schoolId } },
              SupplyRequestItem: { ingredientEntryId: { in: entryIds } },
            },
          };
          const candidates = await tx.ingredientLot.findMany({
            where: lotWhere,
            select: { id: true },
            orderBy: { id: "asc" },
          });
          await lockLots(
            tx,
            candidates.map((lot) => lot.id),
          );
          const stock = await tx.ingredientLot.findMany({
            where: {
              AND: [lotWhere, { id: { in: candidates.map((lot) => lot.id) } }],
            },
            select: {
              id: true,
              unit: true,
              availableQuantity: true,
              DeliveryItem: {
                select: {
                  SupplyRequestItem: { select: { ingredientEntryId: true } },
                },
              },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });
          const held = await reservations(tx, stock);
          const planningStock: PlanningLot[] = stock.map((lot) => ({
            id: lot.id,
            unit: lot.unit,
            ingredientEntryId:
              lot.DeliveryItem.SupplyRequestItem.ingredientEntryId,
            availableQuantity: lot.availableQuantity.toString(),
            reservedQuantity: held.get(lot.id)!.toString(),
          }));
          const plans = planCookingBatches(
            portions - planned,
            school.cookingMode,
            recipe.map((row) => ({
              ingredientEntryId: row.ingredientEntryId,
              quantityPerPortion: row.requiredQuantity.toString(),
              unit: row.unit,
            })),
            planningStock,
          );
          const created: Detail[] = [];
          for (const plan of plans) {
            created.push(
              await tx.cookingBatch.create({
                data: {
                  ...input,
                  batchCode: `CB-${randomUUID()}`,
                  cookingModeApplied: school.cookingMode,
                  createdByUserId: actor.id,
                  plannedPortions: plan.plannedPortions,
                  cookingBatchLots: { create: plan.lots },
                },
                select: detailSelect,
              }),
            );
          }
          return { created: true, batches: [...existing, ...created].map(dto) };
        },
      );
    },

    confirm(id: string, principal: AuthPrincipal) {
      return write(
        principal,
        "cooking_batch.confirm",
        async (tx, actor, schoolId) => {
          const batch = await lockedBatch(tx, id, schoolId);
          if (batch.status !== "UNCONFIRMED") return dto(batch);
          await checkReservedStock(tx, batch, schoolId);
          return dto(
            await tx.cookingBatch.update({
              where: { id },
              data: {
                status: "CONFIRMED",
                confirmedAt: new Date(),
                confirmedByUserId: actor.id,
              },
              select: detailSelect,
            }),
          );
        },
      );
    },

    complete(id: string, principal: AuthPrincipal) {
      return write(
        principal,
        "cooking_batch.complete",
        async (tx, actor, schoolId) => {
          const batch = await lockedBatch(tx, id, schoolId);
          if (batch.status === "COMPLETED") return dto(batch);
          if (batch.status !== "CONFIRMED")
            throw new HttpError(
              409,
              "Phải xác nhận kế hoạch trước khi hoàn thành",
            );
          const stock = await checkReservedStock(tx, batch, schoolId);
          if (
            await tx.inventoryTransaction.count({
              where: {
                movementType: "COOKING_USAGE",
                referenceType: "COOKING_BATCH",
                referenceId: id,
              },
            })
          )
            throw new HttpError(
              409,
              "Mẻ chưa hoàn thành nhưng đã có tiêu hao kho; cần đối chiếu lịch sử",
            );
          for (const allocation of batch.cookingBatchLots) {
            const lot = stock.get(allocation.ingredientLotId)!;
            const used = convertQuantity(
              allocation.quantityUsed,
              allocation.unit,
              lot.unit,
            );
            if (used.decimalPlaces() > 3 || !used.gt(0))
              throw new HttpError(409, "Lượng tiêu hao không hợp lệ");
            const changed = await tx.ingredientLot.updateMany({
              where: {
                id: lot.id,
                status: "AVAILABLE",
                availableQuantity: { gte: used },
              },
              data: {
                availableQuantity: { decrement: used },
                status: lot.availableQuantity.eq(used)
                  ? "DEPLETED"
                  : "AVAILABLE",
              },
            });
            if (changed.count !== 1)
              throw new HttpError(
                409,
                "Tồn kho đã thay đổi; chưa ghi nhận hoàn thành",
              );
            await tx.inventoryTransaction.create({
              data: {
                ingredientLotId: lot.id,
                movementType: "COOKING_USAGE",
                quantity: used,
                unit: lot.unit,
                createdByUserId: actor.id,
                referenceType: "COOKING_BATCH",
                referenceId: id,
              },
            });
          }
          return dto(
            await tx.cookingBatch.update({
              where: { id },
              data: {
                status: "COMPLETED",
                completedAt: new Date(),
                completedByUserId: actor.id,
              },
              select: detailSelect,
            }),
          );
        },
      );
    },
  };
}

export const kitchenLifecycle = createKitchenLifecycle();
export type KitchenLifecycle = ReturnType<typeof createKitchenLifecycle>;
