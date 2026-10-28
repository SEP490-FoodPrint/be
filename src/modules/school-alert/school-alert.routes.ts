import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createSchoolAlertController } from "./school-alert.controller";
import {
  schoolAlertService,
  type SchoolAlertService,
} from "./school-alert.service";

export function createSchoolAlertRouter(
  service: SchoolAlertService = schoolAlertService,
) {
  const router = Router();
  const controller = createSchoolAlertController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createSchoolAlertRouter();
