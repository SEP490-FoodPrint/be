import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { createAuthorityOfficerController } from "./authority-officer.controller";
import {
  authorityOfficerService,
  type AuthorityOfficerService,
} from "./authority-officer.service";

/** `/api/authority-officers`: System Admin cấp và xem tài khoản ATTP (specs/authority-officer-accounts). */
export function createAuthorityOfficerRouter(
  service: AuthorityOfficerService = authorityOfficerService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAuthorityOfficerController(service);
  const manage = requirePermission("authority.manage");
  router.post("/", authHandler, manage, controller.create);
  router.get("/", authHandler, manage, controller.list);
  router.get("/:userId", authHandler, manage, controller.getOne);
  return router;
}

export default createAuthorityOfficerRouter();
