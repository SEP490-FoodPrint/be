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
  router.get("/", authHandler, requireResource("class"), controller.getAll);
  return router;
}

export default createClassRouter();

export function createClassSchoolRouter(
  authHandler: RequestHandler = authenticate,
  service: ClassService = classService,
) {
  const router = Router({ mergeParams: true });
  router.get(
    "/",
    authHandler,
    requireResource("class"),
    createClassController(service).getBySchool,
  );
  return router;
}
