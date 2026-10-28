import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createClassController } from "./class.controller";
import { classService, type ClassService } from "./class.service";

export function createClassRouter(service: ClassService = classService) {
  const router = Router();
  const controller = createClassController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createClassRouter();
