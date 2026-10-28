import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createFoodAnalysisController } from "./food-analysis.controller";
import {
  foodAnalysisService,
  type FoodAnalysisService,
} from "./food-analysis.service";

export function createFoodAnalysisRouter(
  service: FoodAnalysisService = foodAnalysisService,
) {
  const router = Router();
  const controller = createFoodAnalysisController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createFoodAnalysisRouter();
