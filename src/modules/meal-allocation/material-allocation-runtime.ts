import { Worker } from "node:worker_threads";
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
import type { MaterialPlanResponseDTO } from "./material-allocation.response.dto";

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

export function solveInWorker(
  data: Awaited<ReturnType<typeof readValidatedMaterialData>>,
  date: string,
  mealType: MealType,
) {
  return new Promise<MaterialPlanResponseDTO>((resolve, reject) => {
    const worker = new Worker(
      `
      const { workerData, parentPort } = require("node:worker_threads");
      if (workerData.registration) require(workerData.registration);
      const { buildMaterialPlan } = require(workerData.module);
      try {
        parentPort.postMessage({ plan: buildMaterialPlan(JSON.parse(workerData.data), workerData.date, workerData.parameters) });
      } catch (error) {
        parentPort.postMessage({ error: error.statusCode === 409 ? error.message : "Không thể tính đề xuất phân bổ" });
      }
    `,
      {
        eval: true,
        workerData: {
          module: require.resolve("./material-allocation.service"),
          registration: __filename.endsWith(".ts")
            ? require.resolve("tsx/cjs")
            : null,
          data: JSON.stringify(data),
          date,
          parameters: parameters(mealType),
        },
      },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new HttpError(409, "Tác vụ tính phương án quá thời gian"));
    }, 30000);
    worker.once(
      "message",
      (message: { plan?: MaterialPlanResponseDTO; error?: string }) => {
        clearTimeout(timeout);
        if (message.plan) resolve(message.plan);
        else
          reject(
            new HttpError(
              409,
              message.error ?? "Không thể tính đề xuất phân bổ",
            ),
          );
      },
    );
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    worker.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Worker stopped"));
    });
  });
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

    const candidate = await db.mealAllocationDraft.findFirst({
      where: {
        OR: [
          { state: "PENDING" },
          { state: "RUNNING", updatedAt: { lt: new Date(Date.now() - 60000) } },
        ],
      },
      orderBy: { updatedAt: "asc" },
    });
    if (!candidate) return;
    const { schoolId, mealDate, mealType } = candidate;
    const key = { schoolId, mealDate, mealType };
    const revision = draftRevision();
    const claim = await db.mealAllocationDraft.updateMany({
      where: { ...key, revision: candidate.revision },
      data: { state: "RUNNING", revision },
    });
    if (!claim.count) return;
    const lease = { ...key, revision };
    try {
      const date = dateText(mealDate);
      const data = await db.$transaction(
        (tx) => readValidatedMaterialData(tx, schoolId, mealDate, mealType),
        { isolationLevel: "RepeatableRead" },
      );
      if (
        saved(data.day) ||
        projectAllocationDay(data.day, date, mealType).status !== "READY"
      ) {
        await db.mealAllocationDraft.deleteMany({ where: lease });
        return;
      }
      const sourceRevision = allocationHash({
        date,
        input: parameters(mealType),
        data,
      });
      const plan = await solveInWorker(data, date, mealType);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM foodprint.schools WHERE id = ${schoolId}::uuid FOR UPDATE`;
        const latest = await readValidatedMaterialData(
          tx,
          schoolId,
          mealDate,
          mealType,
        );
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
