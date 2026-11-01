import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createOrganizationController } from "./organization.controller";
import {
  organizationService,
  type OrganizationService,
} from "./organization.service";

export function createOrganizationRouter(
  service: OrganizationService = organizationService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createOrganizationController(service);

  // Public endpoints (Không yêu cầu đăng nhập)
  router.get("/public", controller.getPublicSchools);
  router.get("/public/code/:code", controller.getPublicSchoolByCode);
  router.get("/public/:id", controller.getPublicSchoolById);

  // Internal admin endpoint
  router.get(
    "/",
    authHandler,
    requireResource("organization"),
    controller.getAll,
  );
  return router;
}

export default createOrganizationRouter();
