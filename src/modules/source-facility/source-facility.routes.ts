import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createSourceFacilityController } from "./source-facility.controller";
import {
  sourceFacilityService,
  type SourceFacilityService,
} from "./source-facility.service";

export function createSourceFacilityRouter(
  service: SourceFacilityService = sourceFacilityService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSourceFacilityController(service);
  router.get(
    "/",
    authHandler,
    requireResource("source-facility"),
    controller.getAll,
  );
  return router;
}

export default createSourceFacilityRouter();
