import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createWarehouseController } from "./warehouse.controller";
import { warehouseService, type WarehouseService } from "./warehouse.service";

export function createWarehouseRouter(
  service: WarehouseService = warehouseService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createWarehouseController(service);
  router.get("/", authHandler, requireResource("warehouse"), controller.getAll);
  return router;
}

export default createWarehouseRouter();
