import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createTraceabilityController } from "./traceability.controller";
import {
  traceabilityService,
  type TraceabilityService,
} from "./traceability.service";

export function createTraceabilityRouter(
  service: TraceabilityService = traceabilityService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createTraceabilityController(service);
  router.get(
    "/",
    authHandler,
    requireResource("traceability"),
    controller.getAll,
  );
  return router;
}

export default createTraceabilityRouter();
