import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requireResource,
  requirePermission,
} from "../../middlewares/permission.middleware";
import { createMealAllocationController } from "./meal-allocation.controller";
import {
  mealAllocationService,
  type MealAllocationService,
} from "./meal-allocation.service";

export function createMealAllocationRouter(
  service: MealAllocationService = mealAllocationService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createMealAllocationController(service);
  router.get(
    "/:id",
    authHandler,
    requireResource("meal-allocation"),
    controller.getOne,
  );
  router.post(
    "/",
    authHandler,
    requirePermission("meal_allocation.create"),
    controller.create,
  );
  router.post(
    "/:id/distribute",
    authHandler,
    requirePermission("meal_allocation.distribute"),
    controller.distribute,
  );
  router.get(
    "/",
    authHandler,
    requireResource("meal-allocation"),
    controller.getAll,
  );
  return router;
}

export default createMealAllocationRouter();
