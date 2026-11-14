import { Router } from "express";
import type { RequestHandler } from "express";
import {
  ingredientSingleUpload,
  ingredientMultipleUpload,
} from "../../middlewares/ingredient-upload.middleware";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { ingredientManagementScope } from "../../utils/resource-access";
import { requirePrincipal } from "../../utils/authorization";
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
  const management = Router();
  management.use(authHandler, (req, _res, next) => {
    try {
      ingredientManagementScope(requirePrincipal(req));
      next();
    } catch (error) {
      next(error);
    }
  });
  management.post(
    "/upload-image",
    controller.authorizeUpload,
    ingredientSingleUpload,
    controller.uploadImage,
  );
  management.post(
    "/upload-images",
    controller.authorizeUpload,
    ingredientMultipleUpload,
    controller.uploadImages,
  );
  management.get("/categories", controller.listCategories);
  management.get("/", controller.listManagement);
  management.post("/", controller.create);
  management.get("/:ingredientId", controller.getDetail);
  management.patch("/:ingredientId", controller.update);
  management.post("/:ingredientId/hide", controller.hide);
  router.use("/management", management);
  router.get(
    "/",
    authHandler,
    requireResource("ingredient"),
    controller.getAll,
  );
  return router;
}
export default createIngredientRouter();
