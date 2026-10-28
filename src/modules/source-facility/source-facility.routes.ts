import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createSourceFacilityController } from "./source-facility.controller";
import {
  sourceFacilityService,
  type SourceFacilityService,
} from "./source-facility.service";

export function createSourceFacilityRouter(
  service: SourceFacilityService = sourceFacilityService,
) {
  const router = Router();
  const controller = createSourceFacilityController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createSourceFacilityRouter();
