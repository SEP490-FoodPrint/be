import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createIngredientQualityFeedbackController } from "./ingredient-quality-feedback.controller";
import {
  ingredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "./ingredient-quality-feedback.service";

export function createIngredientQualityFeedbackRouter(
  service: IngredientQualityFeedbackService = ingredientQualityFeedbackService,
) {
  const router = Router();
  const controller = createIngredientQualityFeedbackController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createIngredientQualityFeedbackRouter();
