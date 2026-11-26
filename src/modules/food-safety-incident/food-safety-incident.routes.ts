import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { receiveEvidenceFiles } from "../../utils/evidence-files";
import { createFoodSafetyIncidentController } from "./food-safety-incident.controller";
import {
  foodSafetyIncidentService,
  type FoodSafetyIncidentService,
} from "./food-safety-incident.service";

export function createFoodSafetyIncidentRouter(
  service: FoodSafetyIncidentService = foodSafetyIncidentService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createFoodSafetyIncidentController(service);
  const resource = requireResource("food-safety-incident");
  const manage = requirePermission("food_safety_incident.manage");
  router.get("/", authHandler, resource, controller.getAll);
  router.post(
    "/",
    authHandler,
    requirePermission("food_safety_incident.report"),
    receiveEvidenceFiles,
    controller.report,
  );
  router.post(
    "/direct",
    authHandler,
    requirePermission("food_safety_incident.create"),
    receiveEvidenceFiles,
    controller.createDirect,
  );
  router.get("/:id", authHandler, resource, controller.getOne);
  router.get(
    "/:id/trace-snapshots/:version",
    authHandler,
    resource,
    controller.getTraceSnapshot,
  );
  router.post(
    "/:id/forward",
    authHandler,
    requirePermission("food_safety_incident.forward"),
    receiveEvidenceFiles,
    controller.forward,
  );
  router.post("/:id/cancel", authHandler, manage, controller.cancel);
  router.post(
    "/:id/allocations",
    authHandler,
    manage,
    controller.addAllocations,
  );
  return router;
}

export default createFoodSafetyIncidentRouter();
