import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createMealAttendanceController } from "./meal-attendance.controller";
import {
  mealAttendanceService,
  type MealAttendanceService,
} from "./meal-attendance.service";

export function createMealAttendanceRouter(
  service: MealAttendanceService = mealAttendanceService,
) {
  const router = Router();
  const controller = createMealAttendanceController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createMealAttendanceRouter();
