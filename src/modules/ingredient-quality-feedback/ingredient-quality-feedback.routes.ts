import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { requirePrincipal } from "../../utils/authorization";
import {
  ingredientQualityFeedbackReadScope,
  ingredientQualityFeedbackResponseScope,
} from "../../utils/resource-access";
import { createIngredientQualityFeedbackController } from "./ingredient-quality-feedback.controller";
import {
  ingredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "./ingredient-quality-feedback.service";

const requireDetailScope: RequestHandler = (req, _res, next) => {
  try {
    ingredientQualityFeedbackReadScope(requirePrincipal(req), "detail");
    next();
  } catch (error) {
    next(error);
  }
};

const requireResponseScope: RequestHandler = (req, _res, next) => {
  try {
    ingredientQualityFeedbackResponseScope(requirePrincipal(req));
    next();
  } catch (error) {
    next(error);
  }
};

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
  router.get(
    "/:feedbackId",
    authHandler,
    requireDetailScope,
    controller.getDetail,
  );
  router.post(
    "/:feedbackId/response",
    authHandler,
    requireResponseScope,
    controller.respond,
  );
  return router;
}

export default createIngredientQualityFeedbackRouter();
