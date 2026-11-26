import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { receiveEvidenceFiles } from "../../utils/evidence-files";
import { createFoodSafetyInspectionController } from "./food-safety-inspection.controller";
import {
  foodSafetyInspectionService,
  INSPECTION_PERMISSION,
  type FoodSafetyInspectionService,
} from "./food-safety-inspection.service";

/** PR6a: gắn cùng mount `/api/food-safety-incidents` với module `food-safety-incident`. */
export function createFoodSafetyInspectionRouter(
  service: FoodSafetyInspectionService = foodSafetyInspectionService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createFoodSafetyInspectionController(service);
  const manage = requirePermission(INSPECTION_PERMISSION);
  router.get(
    "/:id/inspection-suppliers",
    authHandler,
    manage,
    controller.getSupplierOptions,
  );
  router.post("/:id/inspections", authHandler, manage, controller.plan);
  router.post(
    "/:id/inspections/:inspectionId/result",
    authHandler,
    manage,
    receiveEvidenceFiles,
    controller.recordResult,
  );
  router.post("/:id/close", authHandler, manage, controller.close);
  return router;
}

export default createFoodSafetyInspectionRouter();
