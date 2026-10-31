import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { createPermissionController } from "./permission.controller";
import {
  permissionService,
  type PermissionService,
} from "./permission.service";
export function createPermissionRouter(
  authHandler: RequestHandler = authenticate,
  service: PermissionService = permissionService,
) {
  const router = Router();
  const c = createPermissionController(service);
  router.get("/permissions", authHandler, c.list);
  router.post("/permissions", authHandler, c.create);
  router.get("/roles/:roleId/permissions", authHandler, c.role);
  router.put("/roles/:roleId/permissions", authHandler, c.replaceRole);
  router.get("/users/:userId/permissions", authHandler, c.user);
  router.put(
    "/users/:userId/permission-denials/:permissionId",
    authHandler,
    c.disable,
  );
  router.delete(
    "/users/:userId/permission-denials/:permissionId",
    authHandler,
    c.enable,
  );
  return router;
}
