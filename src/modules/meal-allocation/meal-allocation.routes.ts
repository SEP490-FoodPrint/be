import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createMealAllocationController } from "./meal-allocation.controller";
import {
  mealAllocationService,
  type MealAllocationService,
} from "./meal-allocation.service";

export function createMealAllocationRouter(
  service: MealAllocationService = mealAllocationService,
) {
  const router = Router();
  const controller = createMealAllocationController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createMealAllocationRouter();
