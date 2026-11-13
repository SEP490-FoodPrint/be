import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requireResource,
  requirePermission,
} from "../../middlewares/permission.middleware";
import {
  createDeliveryController,
  createDeliveryInspectionController,
} from "./delivery.controller";
import { deliveryService, type DeliveryService } from "./delivery.service";
import {
  deliveryInspectionService,
  type DeliveryInspectionService,
} from "./delivery.service";

export function createDeliveryRouter(
  service: DeliveryService = deliveryService,
  authHandler: RequestHandler = authenticate,
  inspections: DeliveryInspectionService = deliveryInspectionService,
) {
  const router = Router();
  const controller = createDeliveryController(service);
  const inspectionController = createDeliveryInspectionController(inspections);
  router.post(
    "/:id/inspection",
    authHandler,
    requirePermission("delivery.inspect"),
    inspectionController.decide,
  );
  router.get(
    "/inspections",
    authHandler,
    requirePermission("delivery.view"),
    inspectionController.list,
  );
  router.get(
    "/:id/inspection",
    authHandler,
    requirePermission("delivery.view"),
    inspectionController.detail,
  );
  router.get("/", authHandler, requireResource("delivery"), controller.getAll);
  return router;
}

export default createDeliveryRouter();
