import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { receivePhoto } from "../../utils/record-photo";
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
  router.get(
    "/day-progress",
    authHandler,
    requireResource("kitchen"),
    controller.dayProgress,
  );
  // Đã gỡ bỏ API chỉnh sửa (PUT /:id) và xóa (DELETE /:id) lô chế biến theo yêu cầu nghiệp vụ
  router.get(
    "/groups/:id",
    authHandler,
    requireResource("kitchen"),
    controller.getGroup,
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
    receivePhoto,
    sampleController.create,
  );
  // TASK-10 v8 (V29, V32): bếp dùng thẳng mẻ do luồng đợt giao tạo, đã gỡ lập mẻ thủ công
  // (GET /plan xem trước và POST / tạo kế hoạch).
  router.get(
    "/:id",
    authHandler,
    requireResource("kitchen"),
    controller.getOne,
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
