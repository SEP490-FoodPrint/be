import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createUserController } from "./user.controller";
import { userService, type UserService } from "./user.service";

export function createUserRouter(service: UserService = userService) {
  const router = Router();
  const controller = createUserController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createUserRouter();
