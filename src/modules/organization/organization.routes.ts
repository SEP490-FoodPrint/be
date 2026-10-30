import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createOrganizationController } from "./organization.controller";
import {
  organizationService,
  type OrganizationService,
} from "./organization.service";

export function createOrganizationRouter(
  service: OrganizationService = organizationService,
) {
  const router = Router();
  const controller = createOrganizationController(service);

  // Public endpoints (Không yêu cầu đăng nhập)
  router.get("/public", controller.getPublicSchools);
  router.get("/public/code/:code", controller.getPublicSchoolByCode);
  router.get("/public/:id", controller.getPublicSchoolById);

  // Internal admin endpoint
  router.get("/", ...systemAdminOnly, controller.getAll);

  return router;
}

export default createOrganizationRouter();
