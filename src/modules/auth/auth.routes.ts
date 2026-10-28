import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createAuthController } from "./auth.controller";
import { authService, type AuthService } from "./auth.service";

export function createAuthRouter(service: AuthService = authService) {
  const router = Router();
  const controller = createAuthController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createAuthRouter();
