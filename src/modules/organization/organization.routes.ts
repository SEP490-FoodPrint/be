import { Router } from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { sendError } from "../../utils/response";
import { createOrganizationController } from "./organization.controller";
import {
  organizationService,
  type OrganizationService,
} from "./organization.service";
import { OrganizationValidationError } from "./organization.validation";

const organizationValidationErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (!(error instanceof OrganizationValidationError)) return next(error);
  return sendError(res, error.message, error.statusCode, {
    fields: error.fields,
  });
};

export function createOrganizationRouter(
  service: OrganizationService = organizationService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createOrganizationController(service);

  // Public endpoints (Không yêu cầu đăng nhập)
  router.get("/public", controller.getPublicSchools);
  router.get("/public/locations", controller.getPublicLocations);
  router.get("/public/code/:code", controller.getPublicSchoolByCode);
  router.get("/public/:schoolCode/daily-menu", controller.getPublicDailyMenu);
  router.get("/public/:schoolCode/weekly-menu", controller.getPublicWeeklyMenu);
  router.get("/public/:id", controller.getPublicSchoolById);

  // Internal admin endpoint
  router.get(
    "/",
    authHandler,
    requireResource("organization"),
    controller.getAll,
  );

  router.use(organizationValidationErrorHandler);
  return router;
}

export default createOrganizationRouter();
