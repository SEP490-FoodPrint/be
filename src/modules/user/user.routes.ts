import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createUserController } from "./user.controller";
import { userService, type UserService } from "./user.service";

export function createUserRouter(
  service: UserService = userService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createUserController(service);
  router.get("/", authHandler, requireResource("user"), controller.getAll);
  return router;
}

export default createUserRouter();

export function createUserSchoolRouter(
  authHandler: RequestHandler = authenticate,
  service: UserService = userService,
) {
  const router = Router({ mergeParams: true });
  const controller = createUserController(service);
  router.get("/", authHandler, requireResource("user"), controller.getBySchool);
  router.post(
    "/",
    authHandler,
    requirePermission("school_user.manage"),
    controller.createSchoolAccount,
  );
  router.put(
    "/:userId",
    authHandler,
    requirePermission("school_user.manage"),
    controller.updateSchoolAccount,
  );
  router.patch(
    "/:userId/status",
    authHandler,
    requirePermission("school_user.manage"),
    controller.toggleAccountStatus,
  );
  return router;
}
