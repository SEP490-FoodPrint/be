import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { HttpError } from "../../utils/http-error";
import { readAllocationDay } from "./meal-allocation.repository";
import { projectAllocationDay } from "./meal-allocation.service";
import {
  allocationDateFormat,
  allocationHash,
  draftRevision,
  readValidatedMaterialData,
} from "./material-allocation.service";
import { solveInWorker } from "./material-allocation-solver";

export { solveInWorker };

type MealType = "LUNCH" | "AFTERNOON";
const dateText = (date: Date) => date.toISOString().slice(0, 10);
const parameters = (mealType: MealType) => ({ mealType, priorityClassIds: [] });
const saved = (day: Awaited<ReturnType<typeof readAllocationDay>>) =>
  day.demands.some((demand) => demand.MealAllocation !== null);

export async function queueAllocationDraft(
  tx: Prisma.TransactionClient,
  schoolId: string,
  mealDate: Date,
  mealType: MealType,
) {
  const key = { schoolId, mealDate, mealType };
  const existing = await tx.mealAllocationDraft.findUnique({
    where: { schoolId_mealDate_mealType: key },
    select: { state: true },
  });
  if (existing) return;
  const day = await readAllocationDay(tx, schoolId, mealDate, mealType);
  if (
    saved(day) ||
    projectAllocationDay(day, dateText(mealDate), mealType).status !== "READY"
  )
    return;
  await tx.mealAllocationDraft.createMany({
    data: { ...key, state: "PENDING", revision: draftRevision() },
    skipDuplicates: true,
  });
}

export const allocationDraftDeps = {
  read: readValidatedMaterialData,
  solve: solveInWorker,
};

export async function processNextAllocationDraft(
  db: PrismaClient,
  deps: typeof allocationDraftDeps = allocationDraftDeps,
) {
  const candidate = await db.mealAllocationDraft.findFirst({
    where: {
      OR: [
        { state: "PENDING" },
        { state: "RUNNING", updatedAt: { lt: new Date(Date.now() - 60000) } },
      ],
    },
    orderBy: { updatedAt: "asc" },
  });
  if (!candidate) return false;
  const { schoolId, mealDate, mealType } = candidate;
  const key = { schoolId, mealDate, mealType };
  const revision = draftRevision();
  const claim = await db.mealAllocationDraft.updateMany({
    where: { ...key, revision: candidate.revision },
    data: { state: "RUNNING", revision },
  });
  if (!claim.count) return false;
  const lease = { ...key, revision };
  try {
    const date = dateText(mealDate);
    const data = await db.$transaction(
      (tx) => deps.read(tx, schoolId, mealDate, mealType),
      { isolationLevel: "RepeatableRead" },
    );
    if (
      saved(data.day) ||
      projectAllocationDay(data.day, date, mealType).status !== "READY"
    ) {
      await db.mealAllocationDraft.deleteMany({ where: lease });
      return true;
    }
    const sourceRevision = allocationHash({
      date,
      input: parameters(mealType),
      data,
    });
    const plan = await deps.solve(data, date, mealType);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM foodprint.schools WHERE id = ${schoolId}::uuid FOR UPDATE`;
      const latest = await deps.read(tx, schoolId, mealDate, mealType);
      if (saved(latest.day)) {
        await tx.mealAllocationDraft.deleteMany({ where: lease });
        return;
      }
      if (
        sourceRevision !==
        allocationHash({ date, input: parameters(mealType), data: latest })
      ) {
        await tx.mealAllocationDraft.updateMany({
          where: lease,
          data: { state: "PENDING", revision: draftRevision() },
        });
        return;
      }
      await tx.mealAllocationDraft.updateMany({
        where: lease,
        data: {
          state: "DRAFT",
          sourceRevision,
          plan: JSON.parse(
            JSON.stringify({ ...plan, revision: sourceRevision }),
          ) as Prisma.InputJsonValue,
          error: null,
        },
      });
    });
  } catch (error) {
    if (!(error instanceof HttpError))
      console.error("Allocation draft worker failed", error);
    await db.mealAllocationDraft.updateMany({
      where: lease,
      data: {
        state: "FAILED",
        error:
          error instanceof HttpError
            ? error.message
            : "Không thể chuẩn bị phương án",
      },
    });
  }
  return true;
}

export function startAllocationDraftRuntime(db: PrismaClient) {
  let active: Promise<void> | undefined;
  let lastSweep = 0;

  async function tick() {
    if (Date.now() - lastSweep >= 60000) {
      const mealDate = new Date(allocationDateFormat.format(new Date()));
      const menus = await db.menuDay.findMany({
        where: {
          menuDate: mealDate,
          approvalStatus: "APPROVED",
          cookingBatches: {
            some: { dishes: { some: { retainedFoodSamples: { some: {} } } } },
          },
        },
        select: {
          WeeklyMenu: { select: { schoolId: true } },
          menuDayDishes: { select: { mealType: true } },
        },
      });
      const schools = new Map<string, Set<MealType>>();
      for (const menu of menus) {
        const id = menu.WeeklyMenu.schoolId;
        if (!schools.has(id)) schools.set(id, new Set());
        for (const dish of menu.menuDayDishes)
          schools.get(id)!.add(dish.mealType);
      }
      for (const [schoolId, meals] of schools) {
        for (const mealType of meals)
          await db.$transaction((tx) =>
            queueAllocationDraft(tx, schoolId, mealDate, mealType),
          );
      }
      lastSweep = Date.now();
    }

    await processNextAllocationDraft(db);
  }

  const timer = setInterval(() => {
    active ??= tick()
      .catch((error) => console.error("Allocation draft runtime failed", error))
      .finally(() => {
        active = undefined;
      });
  }, 1500);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await active;
  };
}
