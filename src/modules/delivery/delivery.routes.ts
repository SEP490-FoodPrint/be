import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createDeliveryController } from "./delivery.controller";
import { deliveryService, type DeliveryService } from "./delivery.service";

export function createDeliveryRouter(
  service: DeliveryService = deliveryService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createDeliveryController(service);
  router.get("/", authHandler, requireResource("delivery"), controller.getAll);
  return router;
}

export default createDeliveryRouter();
