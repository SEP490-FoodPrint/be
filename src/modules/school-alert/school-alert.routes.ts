import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createSchoolAlertController } from "./school-alert.controller";
import {
  schoolAlertService,
  type SchoolAlertService,
} from "./school-alert.service";

export function createSchoolAlertRouter(
  service: SchoolAlertService = schoolAlertService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSchoolAlertController(service);
  router.get(
    "/",
    authHandler,
    requireResource("school-alert"),
    controller.getAll,
  );
  return router;
}

export default createSchoolAlertRouter();
