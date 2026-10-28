import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createIngredientEntryController } from "./ingredient-entry.controller";
import {
  ingredientEntryService,
  type IngredientEntryService,
} from "./ingredient-entry.service";

export function createIngredientEntryRouter(
  service: IngredientEntryService = ingredientEntryService,
) {
  const router = Router();
  const controller = createIngredientEntryController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createIngredientEntryRouter();
