import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createClassController } from "./class.controller";
import { classService, type ClassService } from "./class.service";

export function createClassRouter(
  service: ClassService = classService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createClassController(service);
  router.get("/", authHandler, requireResource("class"), controller.getAll);
  return router;
}

export default createClassRouter();
