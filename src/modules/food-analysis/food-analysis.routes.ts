import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createFoodAnalysisController } from "./food-analysis.controller";
import {
  foodAnalysisService,
  type FoodAnalysisService,
} from "./food-analysis.service";

export function createFoodAnalysisRouter(
  service: FoodAnalysisService = foodAnalysisService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createFoodAnalysisController(service);
  router.get(
    "/",
    authHandler,
    requireResource("food-analysis"),
    controller.getAll,
  );
  return router;
}

export default createFoodAnalysisRouter();
