import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createIngredientEntryController } from "./ingredient-entry.controller";
import {
  ingredientEntryService,
  type IngredientEntryService,
} from "./ingredient-entry.service";

export function createIngredientEntryRouter(
  service: IngredientEntryService = ingredientEntryService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createIngredientEntryController(service);
  router.get(
    "/",
    authHandler,
    requireResource("ingredient-entry"),
    controller.getAll,
  );
  return router;
}

export default createIngredientEntryRouter();
