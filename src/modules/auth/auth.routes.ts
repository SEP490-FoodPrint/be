import { createSessionController } from "./session.controller";
import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createAuthController } from "./auth.controller";
import { authService, type AuthService } from "./auth.service";

export function createAuthRouter(
  service: AuthService = authService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAuthController(service);
  router.get("/roles", authHandler, requireResource("auth"), controller.getAll);
  const session = createSessionController();
  router.post("/login", session.login);
  router.post("/refresh", session.refresh);
  router.post("/logout", session.logout);
  router.get("/me", authHandler, session.me);
  router.get("/me/permissions", authHandler, session.permissions);
  return router;
}

export default createAuthRouter();
