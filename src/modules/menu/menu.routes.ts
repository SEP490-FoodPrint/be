import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createMenuController } from "./menu.controller";
import { menuService, type MenuService } from "./menu.service";

export function createMenuRouter(service: MenuService = menuService) {
  const router = Router();
  const controller = createMenuController(service);

  // Prototype routes remain public until the school RBAC policy is finalized.
  router.get("/:menuId/approval-detail", controller.getApprovalDetail);
  router.post("/:menuId/approve", controller.approve);
  router.post("/:menuId/request-revision", controller.requestRevision);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createMenuRouter();
