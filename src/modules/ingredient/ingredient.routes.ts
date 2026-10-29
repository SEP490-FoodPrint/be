import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createIngredientController } from "./ingredient.controller";
import {
  ingredientService,
  type IngredientService,
} from "./ingredient.service";

export function createIngredientRouter(
  service: IngredientService = ingredientService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createIngredientController(service);
  router.get(
    "/",
    authHandler,
    requireResource("ingredient"),
    controller.getAll,
  );
  return router;
}

export default createIngredientRouter();
