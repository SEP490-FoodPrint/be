import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createReportingController } from "./reporting.controller";
import { reportingService, type ReportingService } from "./reporting.service";

export function createReportingRouter(
  service: ReportingService = reportingService,
) {
  const router = Router();
  const controller = createReportingController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createReportingRouter();
