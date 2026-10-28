import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createWarehouseController } from "./warehouse.controller";
import { warehouseService, type WarehouseService } from "./warehouse.service";

export function createWarehouseRouter(
  service: WarehouseService = warehouseService,
) {
  const router = Router();
  const controller = createWarehouseController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createWarehouseRouter();
