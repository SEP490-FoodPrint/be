import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createInventoryController } from "./inventory.controller";
import { inventoryService, type InventoryService } from "./inventory.service";

export function createInventoryRouter(
  service: InventoryService = inventoryService,
) {
  const router = Router();
  const controller = createInventoryController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createInventoryRouter();
