import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createAuthorityController } from "./authority.controller";
import { authorityService, type AuthorityService } from "./authority.service";

export function createAuthorityRouter(
  service: AuthorityService = authorityService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAuthorityController(service);
  router.get("/", authHandler, requireResource("authority"), controller.getAll);
  return router;
}

export default createAuthorityRouter();
