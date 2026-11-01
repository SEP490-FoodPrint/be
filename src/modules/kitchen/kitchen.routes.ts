import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createKitchenController } from "./kitchen.controller";
import { kitchenService, type KitchenService } from "./kitchen.service";
import { createRetainedSampleController } from "../retained-sample/retained-sample.controller";
import {
  retainedSampleService,
  type RetainedSampleService,
} from "../retained-sample/retained-sample.service";

export function createKitchenRouter(
  service: KitchenService = kitchenService,
  authHandler: RequestHandler = authenticate,
  versioned = false,
  samples: RetainedSampleService = retainedSampleService,
) {
  const router = Router();
  const controller = createKitchenController(service);
  const sampleController = createRetainedSampleController(samples);
  router.put(
    "/:id",
    authHandler,
    requirePermission("cooking_batch.update"),
    controller.update,
  );
  router.delete(
    "/:id",
    authHandler,
    requirePermission("cooking_batch.update"),
    controller.remove,
  );
  router.get(
    "/",
    authHandler,
    requireResource("kitchen"),
    versioned ? controller.list : controller.getAll,
  );
  router.get(
    "/stats",
    authHandler,
    requireResource("kitchen"),
    controller.stats,
  );
  router.get(
    "/:id/inspection-sheet",
    authHandler,
    requireResource("kitchen"),
    controller.inspectionSheet,
  );
  router.get(
    "/:id/food-samples",
    authHandler,
    requirePermission("retained_sample.view"),
    sampleController.forBatch,
  );
  router.post(
    "/:id/food-samples",
    authHandler,
    requirePermission("retained_sample.create"),
    sampleController.create,
  );
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
