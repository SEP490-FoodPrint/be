import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { dishService, type DishService } from "./dish.service";
import { validateDishListQuery } from "./dish.validation";
import {
  validateDishRecipe,
  validateRecipeSelection,
  validateDishCategory,
} from "./dish.validation";
import { dishRecipeService } from "./dish.service";
import { uuid } from "../../utils/auth-validation";

export const dishRecipeController = {
  listCategories: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      items: await dishRecipeService.listCategories(requirePrincipal(req)),
    });
  }),
  createCategory: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.writeCategory(
        undefined,
        validateDishCategory(req.body).name,
        requirePrincipal(req),
      ),
      "Đã tạo nhóm món",
      201,
    );
  }),
  updateCategory: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.writeCategory(
        uuid(req.params.id),
        validateDishCategory(req.body).name,
        requirePrincipal(req),
      ),
    );
  }),
  removeCategory: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.removeCategory(
        uuid(req.params.id),
        requirePrincipal(req),
      ),
    );
  }),
  remove: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.remove(
        uuid(req.params.id),
        requirePrincipal(req),
      ),
      "Đã xóa món chưa sử dụng",
    );
  }),
  catalog: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.catalog(
        validateDishListQuery(req.query),
        requirePrincipal(req),
      ),
    );
  }),
  options: asyncHandler(async (req, res) => {
    sendSuccess(res, await dishRecipeService.options(requirePrincipal(req)));
  }),
  preview: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.preview(
        validateRecipeSelection(req.body).dishIds,
        requirePrincipal(req),
      ),
    );
  }),
  create: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.save(
        undefined,
        validateDishRecipe(req.body),
        requirePrincipal(req),
      ),
      "Đã lưu món và công thức",
      201,
    );
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await dishRecipeService.save(
        uuid(req.params.id),
        validateDishRecipe(req.body),
        requirePrincipal(req),
      ),
      "Đã cập nhật công thức",
    );
  }),
};

export function createDishController(service: DishService = dishService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateDishListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách món ăn thành công");
    }),
  };
}
