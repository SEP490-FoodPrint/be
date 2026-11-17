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
  const privateResponse: RequestHandler = (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  };
  router.get("/roles", authHandler, privateResponse, c.listRoles);
  router.get("/permissions/inactive", authHandler, privateResponse, c.inactive);
  router.get("/permissions", authHandler, privateResponse, c.list);
  router.patch(
    "/permissions/:permissionId",
    authHandler,
    privateResponse,
    c.update,
  );
  router.patch(
    "/permissions/:permissionId/state",
    authHandler,
    privateResponse,
    c.setState,
  );
  router.post("/permissions", authHandler, privateResponse, c.create);
  router.get(
    "/roles/:roleId/permissions",
    authHandler,
    privateResponse,
    c.role,
  );
  router.put(
    "/roles/:roleId/permissions",
    authHandler,
    privateResponse,
    c.replaceRole,
  );
  router.get(
    "/users/:userId/permissions",
    authHandler,
    privateResponse,
    c.user,
  );
  router.put(
    "/users/:userId/permission-denials/:permissionId",
    authHandler,
    privateResponse,
    c.disable,
  );
  router.delete(
    "/users/:userId/permission-denials/:permissionId",
    authHandler,
    privateResponse,
    c.enable,
  );
  return router;
}
