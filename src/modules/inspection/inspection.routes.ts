import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createInspectionController } from "./inspection.controller";
import {
  inspectionService,
  type InspectionService,
} from "./inspection.service";

export function createInspectionRouter(
  service: InspectionService = inspectionService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createInspectionController(service);
  router.get(
    "/",
    authHandler,
    requireResource("inspection"),
    controller.getAll,
  );
  return router;
}

export default createInspectionRouter();
