import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createRetainedSampleController } from "./retained-sample.controller";
import {
  retainedSampleService,
  type RetainedSampleService,
} from "./retained-sample.service";

export function createRetainedSampleRouter(
  service: RetainedSampleService = retainedSampleService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createRetainedSampleController(service);
  router.get(
    "/",
    authHandler,
    requireResource("retained-sample"),
    controller.getAll,
  );
  return router;
}

export default createRetainedSampleRouter();
