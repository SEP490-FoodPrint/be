import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePrincipal } from "../../utils/authorization";
import { sourceFacilityManagementScope } from "../../utils/resource-access";
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
  router.use(authHandler, (req, _res, next) => {
    try {
      sourceFacilityManagementScope(requirePrincipal(req));
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get("/", controller.getAll);
  router.post("/", controller.create);
  router.get("/:sourceFacilityId", controller.getDetail);
  router.patch("/:sourceFacilityId", controller.update);
  router.post("/:sourceFacilityId/deactivate", controller.deactivate);
  return router;
}

export default createSourceFacilityRouter();
