import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createMealAllocationController } from "./meal-allocation.controller";
import {
  mealAllocationService,
  type MealAllocationService,
} from "./meal-allocation.service";
import {
  materialAllocationService,
  type MaterialAllocationService,
} from "./material-allocation.service";

export function createMealAllocationRouter(
  service: MealAllocationService = mealAllocationService,
  authHandler: RequestHandler = authenticate,
  materials: MaterialAllocationService = materialAllocationService,
) {
  const router = Router();
  const controller = createMealAllocationController(service, materials);
  router.get(
    "/",
    authHandler,
    requireResource("meal-allocation"),
    controller.getToday,
  );
  router.put(
    "/",
    authHandler,
    requirePermission("meal_allocation.update"),
    controller.apply,
  );
  router.post(
    "/confirm-distribution",
    authHandler,
    requirePermission("meal_allocation.update"),
    controller.confirmDistribution,
  );
  return router;
}
