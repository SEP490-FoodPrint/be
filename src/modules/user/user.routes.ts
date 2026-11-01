import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
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
