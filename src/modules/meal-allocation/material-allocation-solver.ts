import { Worker } from "node:worker_threads";
import { HttpError } from "../../utils/http-error";
import type { readValidatedMaterialData } from "./material-allocation.service";
import type { MaterialPlanResponseDTO } from "./material-allocation.response.dto";

type MealType = "LUNCH" | "AFTERNOON";
const parameters = (mealType: MealType) => ({ mealType, priorityClassIds: [] });

/** Chạy GLPK trong worker thread để không chặn luồng HTTP. */
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
      reject(new HttpError(409, "Tính quá lâu. Vui lòng thử lại."));
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
