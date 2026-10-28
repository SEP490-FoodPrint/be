import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createAuthorityController } from "./authority.controller";
import { authorityService, type AuthorityService } from "./authority.service";

export function createAuthorityRouter(
  service: AuthorityService = authorityService,
) {
  const router = Router();
  const controller = createAuthorityController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createAuthorityRouter();
