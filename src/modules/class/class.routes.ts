import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createClassController } from "./class.controller";
import { classService, type ClassService } from "./class.service";

export function createClassRouter(
  service: ClassService = classService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createClassController(service);
  router.get("/", authHandler, requireResource("class"), controller.getAll);
  router.get(
    "/academic-years",
    authHandler,
    requireResource("class"),
    controller.getAcademicYears,
  );
  router.get(
    "/eligible-teachers",
    authHandler,
    requirePermission("class_assignment.manage"),
    controller.getEligibleTeachers,
  );
  router.put(
    "/:classId/homeroom-teacher",
    authHandler,
    requirePermission("class_assignment.manage"),
    controller.assignHomeroomTeacher,
  );
  router.delete(
    "/:classId/homeroom-teacher",
    authHandler,
    requirePermission("class_assignment.manage"),
    controller.removeHomeroomTeacher,
  );
  return router;
}

export default createClassRouter();
