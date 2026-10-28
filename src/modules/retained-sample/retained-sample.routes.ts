import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createRetainedSampleController } from "./retained-sample.controller";
import {
  retainedSampleService,
  type RetainedSampleService,
} from "./retained-sample.service";

export function createRetainedSampleRouter(
  service: RetainedSampleService = retainedSampleService,
) {
  const router = Router();
  const controller = createRetainedSampleController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createRetainedSampleRouter();
