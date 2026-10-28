import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createMenuController } from "./menu.controller";
import { menuService, type MenuService } from "./menu.service";

export function createMenuRouter(service: MenuService = menuService) {
  const router = Router();
  const controller = createMenuController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createMenuRouter();
