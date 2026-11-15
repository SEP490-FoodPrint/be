import { Router } from "express";
import { createDeliveryTraceController } from "./delivery-trace.controller";
import {
  deliveryTraceService,
  type DeliveryTraceService,
} from "./delivery-trace.service";

export function createDeliveryTraceRouter(
  service: DeliveryTraceService = deliveryTraceService,
) {
  const router = Router();
  const controller = createDeliveryTraceController(service);

  router.get("/:token", controller.getPublicTrace);

  return router;
}

export default createDeliveryTraceRouter();
