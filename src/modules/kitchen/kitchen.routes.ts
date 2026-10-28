import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createKitchenController } from "./kitchen.controller";
import { kitchenService, type KitchenService } from "./kitchen.service";

export function createKitchenRouter(service: KitchenService = kitchenService) {
  const router = Router();
  const controller = createKitchenController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createKitchenRouter();
