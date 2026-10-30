import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createReportingController } from "./reporting.controller";
import { reportingService, type ReportingService } from "./reporting.service";

export function createReportingRouter(
  service: ReportingService = reportingService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createReportingController(service);
  router.get("/", authHandler, requireResource("reporting"), controller.getAll);
  return router;
}

export default createReportingRouter();
