import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createKitchenController } from "./kitchen.controller";
import { kitchenService, type KitchenService } from "./kitchen.service";
import { kitchenLifecycle, type KitchenLifecycle } from "./kitchen.lifecycle";

export function createKitchenRouter(
  service: KitchenService = kitchenService,
  authHandler: RequestHandler = authenticate,
  lifecycle: KitchenLifecycle = kitchenLifecycle,
) {
  const router = Router();
  const controller = createKitchenController(service, lifecycle);
  router.get("/", authHandler, requireResource("kitchen"), controller.getAll);
  router.get(
    "/:id",
    authHandler,
    requireResource("kitchen"),
    controller.getOne,
  );
  router.post(
    "/",
    authHandler,
    requirePermission("cooking_batch.create"),
    controller.plan,
  );
  router.post(
    "/:id/confirm",
    authHandler,
    requirePermission("cooking_batch.confirm"),
    controller.confirm,
  );
  router.post(
    "/:id/complete",
    authHandler,
    requirePermission("cooking_batch.complete"),
    controller.complete,
  );
  return router;
}

export default createKitchenRouter();
