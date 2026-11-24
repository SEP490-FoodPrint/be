import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createAuthorityController } from "./authority.controller";
import { authorityService, type AuthorityService } from "./authority.service";

export function createAuthorityRouter(
  service: AuthorityService = authorityService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAuthorityController(service);
  router.get("/", authHandler, requireResource("authority"), controller.getAll);
  const areaSchools = requireResource("authority-school");
  router.get("/me/schools", authHandler, areaSchools, controller.listSchools);
  router.get(
    "/me/schools/:schoolId",
    authHandler,
    areaSchools,
    controller.getSchool,
  );
  router.put(
    "/:id/location",
    authHandler,
    requirePermission("authority.manage"),
    controller.assignLocation,
  );
  return router;
}

/** `PUT /api/schools/:schoolId/location` và `PUT /api/suppliers/:supplierId/location` (FR-008). */
export function createOrganizationLocationRouter(
  kind: "school" | "supplier",
  service: AuthorityService = authorityService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAuthorityController(service);
  router.put(
    kind === "school" ? "/:schoolId/location" : "/:supplierId/location",
    authHandler,
    requirePermission("authority.manage"),
    kind === "school"
      ? controller.assignSchoolLocation
      : controller.assignSupplierLocation,
  );
  return router;
}

export default createAuthorityRouter();
