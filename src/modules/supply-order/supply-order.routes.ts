import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createSupplyOrderController } from "./supply-order.controller";
import {
  supplyOrderService,
  type SupplyOrderService,
} from "./supply-order.service";

export function createSupplyOrderRouter(
  service: SupplyOrderService = supplyOrderService,
) {
  const router = Router();
  const controller = createSupplyOrderController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createSupplyOrderRouter();
