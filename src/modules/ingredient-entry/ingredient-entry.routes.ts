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
  // Cấu hình tỷ lệ hao hụt của bếp; service kiểm tra quyền ingredient_waste_rate.manage và phạm vi trường.
  router.get("/waste-rates", authHandler, controller.listWasteRates);
  router.patch(
    "/:ingredientEntryId/waste-rate",
    authHandler,
    controller.updateWasteRate,
  );
  return router;
}

export default createIngredientEntryRouter();
