import { createHash } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";

export const allocationFixtureDate = new Date("2026-11-12");
export const allocationFixtureClock = () => new Date("2026-11-12T03:00:00Z");
export const allocationFixtureStates = ["cooking", "samples", "ready"] as const;
type FixtureState = (typeof allocationFixtureStates)[number];

export async function loadAllocationFixture(
  db: PrismaClient,
  schoolId: string,
  kitchenId: string,
  teacherId: string,
  state: FixtureState,
) {
  const fixtureId = (name: string) => {
    const value = createHash("sha256")
      .update(`meal-allocation-20261112:${schoolId}:${name}`)
      .digest("hex");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
  };
  const date = allocationFixtureDate;
  const mealType = "LUNCH" as const;
  const weekStartDate = new Date("2026-11-09");
  const confirmedAt = new Date("2026-11-12T00:00:00Z");
  const completedAt = new Date("2026-11-12T01:00:00Z");
  const sampledAt = new Date("2026-11-12T02:00:00Z");
  const weeklyMenuId = fixtureId("week");
  const menuDayId = fixtureId("day");
  const batchGroupId = fixtureId("group");
  const dishIds = [fixtureId("rice"), fixtureId("main")];
  const batchIds = [fixtureId("batch-A"), fixtureId("batch-B")];
  const demandIds = [
    fixtureId("demand-A"),
    fixtureId("demand-B"),
    fixtureId("demand-C"),
  ];

  await db.$transaction(async (tx) => {
    const [kitchen, teacher] = await Promise.all([
      tx.user.findFirst({
        where: {
          id: kitchenId,
          schoolId,
          roleCode: "SCHOOL_KITCHEN_STAFF",
          status: "ACTIVE",
        },
      }),
      tx.user.findFirst({
        where: {
          id: teacherId,
          schoolId,
          roleCode: "HOMEROOM_TEACHER",
          status: "ACTIVE",
        },
      }),
    ]);
    if (!kitchen || !teacher)
      throw new Error(
        "Chọn tài khoản bếp và giáo viên đang hoạt động trong cùng trường test.",
      );
    const existing = await tx.weeklyMenu.findUnique({
      where: { schoolId_weekStartDate: { schoolId, weekStartDate } },
    });
    if (existing && existing.id !== weeklyMenuId)
      throw new Error(
        "Trường đã có thực đơn tuần này. Chọn trường test riêng.",
      );
    const foreignDemand = await tx.dailyMealPortion.count({
      where: { mealDate: date, Class: { schoolId }, id: { notIn: demandIds } },
    });
    if (foreignDemand)
      throw new Error("Trường đã có dữ liệu suất ăn khác trong ngày test.");
    if (
      state !== "ready" &&
      (await tx.mealAllocationBatch.count({
        where: { cookingBatchId: { in: batchIds } },
      }))
    )
      throw new Error(
        "Hãy gỡ phân bổ fixture khi đang ở trạng thái ready trước khi đổi trạng thái.",
      );
    await tx.weeklyMenu.upsert({
      where: { id: weeklyMenuId },
      create: {
        id: weeklyMenuId,
        schoolId,
        createdByUserId: kitchenId,
        weekStartDate,
        title: "Fixture phân bổ 12/11/2026",
        status: "APPROVED",
        submittedAt: confirmedAt,
        approvedAt: confirmedAt,
      },
      update: {},
    });
    await tx.menuDay.upsert({
      where: { id: menuDayId },
      create: {
        id: menuDayId,
        weeklyMenuId,
        menuDate: date,
        approvalStatus: "APPROVED",
      },
      update: {},
    });
    for (const [index, dishId] of dishIds.entries()) {
      await tx.dish.upsert({
        where: { id: dishId },
        create: {
          id: dishId,
          schoolId,
          name: index === 0 ? "Cơm fixture 12/11" : "Thịt kho fixture 12/11",
        },
        update: {},
      });
      await tx.menuDayDish.upsert({
        where: { menuDayId_dishId_mealType: { menuDayId, dishId, mealType } },
        create: { menuDayId, dishId, mealType },
        update: {},
      });
    }
    for (const [index, totalPortions] of [40, 35, 25].entries()) {
      const classId = fixtureId(`class-${index}`);
      await tx.class.upsert({
        where: { id: classId },
        create: {
          id: classId,
          schoolId,
          name: ["5A", "5B", "5C"][index],
          academicYear: "2026-2027",
          registeredMealPortions: totalPortions,
        },
        update: {},
      });
      await tx.dailyMealPortion.upsert({
        where: { id: demandIds[index] },
        create: {
          id: demandIds[index],
          classId,
          confirmedByUserId: teacherId,
          mealDate: date,
          mealType,
          totalPortions,
          status: "FINALIZED",
          finalizedAt: confirmedAt,
        },
        update: {},
      });
    }
    await tx.cookingBatchGroup.upsert({
      where: { id: batchGroupId },
      create: {
        id: batchGroupId,
        batchCode: `FIX-G-${batchGroupId}`,
        menuDayId,
        mealType,
        createdByUserId: kitchenId,
      },
      update: {},
    });
    for (const [index, cookingBatchId] of batchIds.entries()) {
      const plannedPortions = index === 0 ? 60 : 40;
      const cooked = index === 0 || state !== "cooking";
      const lifecycle = {
        status: cooked ? ("COMPLETED" as const) : ("CONFIRMED" as const),
        confirmedAt,
        confirmedByUserId: kitchenId,
        completedAt: cooked ? completedAt : null,
        completedByUserId: cooked ? kitchenId : null,
      };
      await tx.cookingBatch.upsert({
        where: { id: cookingBatchId },
        create: {
          id: cookingBatchId,
          batchCode: `FIX-${cookingBatchId}`,
          batchGroupId,
          menuDayId,
          mealType,
          createdByUserId: kitchenId,
          plannedPortions,
          cookingModeApplied: "SEPARATE_BY_LOT",
          ...lifecycle,
        },
        update: lifecycle,
      });
      for (const [dishIndex, dishId] of dishIds.entries()) {
        await tx.cookingBatchDish.upsert({
          where: { cookingBatchId_dishId: { cookingBatchId, dishId } },
          create: {
            cookingBatchId,
            dishId,
            menuDayId,
            mealType,
            plannedPortions,
          },
          update: {},
        });
        if (cooked && (index === 0 || state === "ready" || dishIndex === 0)) {
          await tx.retainedFoodSample.upsert({
            where: { cookingBatchId_dishId: { cookingBatchId, dishId } },
            create: {
              cookingBatchId,
              dishId,
              recordedByUserId: kitchenId,
              sampledAt,
              quantity: 150,
              unit: "g",
              storageLocation: "Tủ fixture",
            },
            update: {},
          });
        } else {
          await tx.retainedFoodSample.deleteMany({
            where: { cookingBatchId, dishId },
          });
        }
      }
    }
  });
  return { batchIds, demandIds };
}
