import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createIngredientQualityFeedbackController } from "./ingredient-quality-feedback.controller";
import {
  ingredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "./ingredient-quality-feedback.service";

export function createIngredientQualityFeedbackRouter(
  service: IngredientQualityFeedbackService = ingredientQualityFeedbackService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createIngredientQualityFeedbackController(service);
  router.get(
    "/",
    authHandler,
    requireResource("ingredient-quality-feedback"),
    controller.getAll,
  );
  return router;
}

export default createIngredientQualityFeedbackRouter();
