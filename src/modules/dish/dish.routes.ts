import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requireResource,
  requirePermission,
} from "../../middlewares/permission.middleware";
import { dishRecipeController } from "./dish.controller";
import { createDishController } from "./dish.controller";
import { dishService, type DishService } from "./dish.service";

export function createDishRouter(
  service: DishService = dishService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createDishController(service);
  router.get(
    "/categories",
    authHandler,
    requirePermission("menu.view"),
    dishRecipeController.listCategories,
  );
  router.post(
    "/categories",
    authHandler,
    requirePermission("menu.create"),
    dishRecipeController.createCategory,
  );
  router.put(
    "/categories/:id",
    authHandler,
    requirePermission("menu.update"),
    dishRecipeController.updateCategory,
  );
  router.delete(
    "/categories/:id",
    authHandler,
    requirePermission("menu.update"),
    dishRecipeController.removeCategory,
  );
  router.delete(
    "/:id",
    authHandler,
    requirePermission("menu.update"),
    dishRecipeController.remove,
  );
  router.get(
    "/catalog",
    authHandler,
    requirePermission("menu.view"),
    dishRecipeController.catalog,
  );
  router.get(
    "/recipe-options",
    authHandler,
    requirePermission("menu.view"),
    dishRecipeController.options,
  );
  router.post(
    "/recipe-preview",
    authHandler,
    requirePermission("menu.view"),
    dishRecipeController.preview,
  );
  router.post(
    "/",
    authHandler,
    requirePermission("menu.create"),
    dishRecipeController.create,
  );
  router.put(
    "/:id",
    authHandler,
    requirePermission("menu.update"),
    dishRecipeController.update,
  );
  router.get("/", authHandler, requireResource("dish"), controller.getAll);
  return router;
}

export default createDishRouter();
