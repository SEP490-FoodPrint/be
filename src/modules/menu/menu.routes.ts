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
  versioned = false,
) {
  const router = Router();
  const controller = createMenuController(service);
  router.get(
    "/",
    authHandler,
    requireResource("menu"),
    versioned ? controller.list : controller.getAll,
  );
  router.post(
    "/allergy-check",
    authHandler,
    requirePermission("menu.view"),
    requirePermission("class_allergy.view"),
    controller.allergyCheck,
  );
  router.get(
    "/week-schedule",
    authHandler,
    requirePermission("menu.view"),
    controller.getWeekSchedule,
  );
  router.get(
    "/ingredient-options/:kind",
    authHandler,
    requirePermission("menu.view"),
    controller.getIngredientOptions,
  );
  const path = "/days/:menuDayId/meals/:mealType";
  router.get(
    path + "/portion-groups",
    authHandler,
    requirePermission("menu.view"),
    controller.getPortionGroups,
  );
  router.put(
    path + "/portion-groups",
    authHandler,
    requirePermission("menu.update"),
    controller.savePortionGroups,
  );
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
  router.post(
    "/",
    authHandler,
    requirePermission("menu.create"),
    controller.create,
  );
  router.get(
    "/:menuId",
    authHandler,
    requirePermission("menu.view"),
    controller.getOne,
  );
  router.put(
    "/:menuId",
    authHandler,
    requirePermission("menu.update"),
    controller.update,
  );
  router.delete(
    "/:menuId",
    authHandler,
    requirePermission("menu.update"),
    controller.remove,
  );
  router.post(
    "/:menuId/submit",
    authHandler,
    requirePermission("menu.update"),
    controller.submit,
  );
  router.post(
    "/:menuId/reviews",
    authHandler,
    requirePermission("menu.review", "menu.approve"),
    controller.review,
  );
  router.get(
    "/:menuId/reviews",
    authHandler,
    requirePermission("menu.view"),
    controller.getReviews,
  );
  return router;
}
export default createMenuRouter();
