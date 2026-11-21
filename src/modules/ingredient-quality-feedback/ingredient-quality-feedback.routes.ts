import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
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

/** Bên xử lý: admin/nhân viên NCC có quyền xem chi tiết + xử lý. */
const requireResponseScope: RequestHandler = (req, _res, next) => {
  try {
    ingredientQualityFeedbackResponseScope(requirePrincipal(req));
    next();
  } catch (error) {
    next(error);
  }
};

/** Người gửi: tài khoản trường có quyền gửi phản ánh. */
const requireRequester = requirePermission(
  "ingredient_quality_feedback.submit",
);

/** Bình luận hai chiều: NCC theo phạm vi xử lý, trường theo quyền gửi. */
const requireCommenter: RequestHandler = (req, res, next) => {
  try {
    if (requirePrincipal(req).orgType === "SUPPLIER")
      requireResponseScope(req, res, next);
    else requireRequester(req, res, next);
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
  router.post("/", authHandler, requireRequester, controller.create);
  router.get(
    "/:feedbackId",
    authHandler,
    requireDetailScope,
    controller.getDetail,
  );
  router.post(
    "/:feedbackId/accept",
    authHandler,
    requireResponseScope,
    controller.accept,
  );
  router.post(
    "/:feedbackId/comments",
    authHandler,
    requireCommenter,
    controller.comment,
  );
  router.post(
    "/:feedbackId/resolve",
    authHandler,
    requireResponseScope,
    controller.resolve,
  );
  router.post(
    "/:feedbackId/satisfy",
    authHandler,
    requireRequester,
    controller.satisfy,
  );
  router.post(
    "/:feedbackId/reopen",
    authHandler,
    requireRequester,
    controller.reopen,
  );
  return router;
}

export default createIngredientQualityFeedbackRouter();
