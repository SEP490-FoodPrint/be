import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createMenuController } from "./menu.controller";
import { menuService, type MenuService } from "./menu.service";

export function createMenuRouter(
  service: MenuService = menuService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createMenuController(service);
  router.get(
    "/:menuId/approval-detail",
    authHandler,
    requireResource("menu"),
    controller.getApprovalDetail,
  );
  router.post(
    "/:menuId/approve",
    authHandler,
    requirePermission("menu.approve"),
    controller.approve,
  );
  router.post(
    "/:menuId/request-revision",
    authHandler,
    requirePermission("menu.review"),
    controller.requestRevision,
  );
  router.get("/", authHandler, requireResource("menu"), controller.getAll);
  return router;
}

export default createMenuRouter();
