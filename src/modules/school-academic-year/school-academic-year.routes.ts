import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { createSchoolAcademicYearController } from "./school-academic-year.controller";
import {
  schoolAcademicYearService,
  type SchoolAcademicYearService,
} from "./school-academic-year.service";

export function createSchoolAcademicYearRouter(
  service: SchoolAcademicYearService = schoolAcademicYearService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSchoolAcademicYearController(service);
  router.get(
    "/",
    authHandler,
    requirePermission("school_academic_year.view"),
    controller.list,
  );
  router.get(
    "/:id",
    authHandler,
    requirePermission("school_academic_year.view"),
    controller.get,
  );
  router.post(
    "/",
    authHandler,
    requirePermission("school_academic_year.manage"),
    controller.create,
  );
  router.patch(
    "/:id",
    authHandler,
    requirePermission("school_academic_year.manage"),
    controller.update,
  );
  return router;
}

export default createSchoolAcademicYearRouter();
