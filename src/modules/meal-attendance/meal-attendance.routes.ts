import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createMealAttendanceController } from "./meal-attendance.controller";
import {
  mealAttendanceService,
  type MealAttendanceService,
} from "./meal-attendance.service";

export function createMealAttendanceRouter(
  service: MealAttendanceService = mealAttendanceService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createMealAttendanceController(service);
  router.get(
    "/",
    authHandler,
    requireResource("meal-attendance"),
    controller.getAll,
  );
  return router;
}

export default createMealAttendanceRouter();
