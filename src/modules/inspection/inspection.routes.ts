import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createInspectionController } from "./inspection.controller";
import {
  inspectionService,
  type InspectionService,
} from "./inspection.service";

export function createInspectionRouter(
  service: InspectionService = inspectionService,
) {
  const router = Router();
  const controller = createInspectionController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createInspectionRouter();
