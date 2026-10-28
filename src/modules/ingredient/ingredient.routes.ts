import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createIngredientController } from "./ingredient.controller";
import {
  ingredientService,
  type IngredientService,
} from "./ingredient.service";

export function createIngredientRouter(
  service: IngredientService = ingredientService,
) {
  const router = Router();
  const controller = createIngredientController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createIngredientRouter();
