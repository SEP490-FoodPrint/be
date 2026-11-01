import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requireResource,
  requirePermission,
} from "../../middlewares/permission.middleware";
import { createMealAttendanceController } from "./meal-attendance.controller";
import {
  mealAttendanceService,
  type MealAttendanceService,
} from "./meal-attendance.service";

export function createMealAttendanceRouter(
  service: MealAttendanceService = mealAttendanceService,
  authHandler: RequestHandler = authenticate,
  versioned = false,
) {
  const router = Router();
  const controller = createMealAttendanceController(service);
  router.get(
    "/:id/portion-groups",
    authHandler,
    requirePermission("daily_meal_portion.view"),
    controller.getPortionGroups,
  );
  router.put(
    "/:id/portion-groups",
    authHandler,
    requirePermission("daily_meal_portion.update"),
    controller.savePortionGroups,
  );
  if (versioned) {
    router.get(
      "/",
      authHandler,
      requirePermission(
        "daily_meal_portion.view",
        "cooking_batch.view",
        "menu.view",
      ),
      controller.summary,
    );
    return router;
  }
  router.get(
    "/",
    authHandler,
    requireResource("meal-attendance"),
    controller.getAll,
  );
  return router;
}

export default createMealAttendanceRouter();
