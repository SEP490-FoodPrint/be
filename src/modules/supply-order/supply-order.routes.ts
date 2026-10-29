import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createSupplyOrderController } from "./supply-order.controller";
import {
  supplyOrderService,
  type SupplyOrderService,
} from "./supply-order.service";

export function createSupplyOrderRouter(
  service: SupplyOrderService = supplyOrderService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplyOrderController(service);
  router.get(
    "/",
    authHandler,
    requireResource("supply-order"),
    controller.getAll,
  );
  return router;
}

export default createSupplyOrderRouter();
