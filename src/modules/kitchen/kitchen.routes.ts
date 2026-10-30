import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createKitchenController } from "./kitchen.controller";
import { kitchenService, type KitchenService } from "./kitchen.service";

export function createKitchenRouter(
  service: KitchenService = kitchenService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createKitchenController(service);
  router.get("/", authHandler, requireResource("kitchen"), controller.getAll);
  return router;
}

export default createKitchenRouter();
