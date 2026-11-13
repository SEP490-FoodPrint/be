import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createSchoolGradeController } from "./school-grade.controller";
import { createSchoolGradeService } from "./school-grade.service";

export function createSchoolGradeRouter(
  service = createSchoolGradeService(),
  auth: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSchoolGradeController(service);
  router.get("/", auth, requireResource("school-grade"), controller.list);
  router.post("/", auth, requirePermission("class.manage"), controller.create);
  router.patch(
    "/:id",
    auth,
    requirePermission("class.manage"),
    controller.update,
  );
  router.delete(
    "/:id",
    auth,
    requirePermission("class.manage"),
    controller.remove,
  );
  return router;
}
