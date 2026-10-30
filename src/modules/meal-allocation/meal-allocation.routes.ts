import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
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
    "/",
    authHandler,
    requireResource("meal-allocation"),
    controller.getAll,
  );
  return router;
}

export default createMealAllocationRouter();
