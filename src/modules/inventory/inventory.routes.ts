import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createInventoryController } from "./inventory.controller";
import { inventoryService, type InventoryService } from "./inventory.service";

export function createInventoryRouter(
  service: InventoryService = inventoryService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createInventoryController(service);
  router.get("/", authHandler, requireResource("inventory"), controller.getAll);
  return router;
}

export default createInventoryRouter();
