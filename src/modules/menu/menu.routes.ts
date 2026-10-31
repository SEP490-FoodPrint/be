import { Router, type RequestHandler } from "express";
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
  router.get("/", authHandler, requireResource("menu"), controller.getAll);
  router.get(
    "/ingredient-options/:kind",
    authHandler,
    requirePermission("menu.view"),
    controller.getIngredientOptions,
  );
  const path = "/days/:menuDayId/meals/:mealType";
  router.get(
    path + "/ingredients",
    authHandler,
    requirePermission("menu.view"),
    controller.getIngredients,
  );
  router.put(
    path + "/ingredients",
    authHandler,
    requirePermission("menu.update"),
    controller.saveIngredients,
  );
  router.get(
    path + "/requirements",
    authHandler,
    requirePermission("menu.view"),
    controller.getRequirements,
  );
  return router;
}
export default createMenuRouter();
