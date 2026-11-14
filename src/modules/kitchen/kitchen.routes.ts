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
  _versioned = false,
  samples: RetainedSampleService = retainedSampleService,
) {
  const router = Router();
  const controller = createKitchenController(service);
  const sampleController = createRetainedSampleController(samples);
  router.get(
    "/context",
    authHandler,
    requireResource("kitchen"),
    controller.getContext,
  );
  // Đã gỡ bỏ API chỉnh sửa lô chế biến (PUT /:id) theo yêu cầu nghiệp vụ
  router.get(
    "/groups/:id",
    authHandler,
    requireResource("kitchen"),
    controller.getGroup,
  );

  router.delete(
    "/:id",
    authHandler,
    requirePermission("cooking_batch.update"),
    controller.remove,
  );
  router.get("/", authHandler, requireResource("kitchen"), controller.list);
  router.get(
    "/stats",
    authHandler,
    requireResource("kitchen"),
    controller.stats,
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
    "/plan",
    authHandler,
    requirePermission("cooking_batch.create"),
    controller.preview,
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
