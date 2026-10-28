import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createDeliveryController } from "./delivery.controller";
import { deliveryService, type DeliveryService } from "./delivery.service";

export function createDeliveryRouter(
  service: DeliveryService = deliveryService,
) {
  const router = Router();
  const controller = createDeliveryController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createDeliveryRouter();
