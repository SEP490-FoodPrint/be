import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createTraceabilityController } from "./traceability.controller";
import {
  traceabilityService,
  type TraceabilityService,
} from "./traceability.service";

export function createTraceabilityRouter(
  service: TraceabilityService = traceabilityService,
) {
  const router = Router();
  const controller = createTraceabilityController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createTraceabilityRouter();
