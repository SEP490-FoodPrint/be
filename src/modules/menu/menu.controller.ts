import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { menuService, type MenuService } from "./menu.service";
import {
  validateMenuListQuery,
  validateMenuMeal,
  validateMenuStandards,
  validateMenuIngredientKind,
} from "./menu.validation";

export function createMenuController(service: MenuService = menuService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const result = await service.getAll(
        validateMenuListQuery(req.query),
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Lấy danh sách thực đơn tuần thành công");
    }),
    getIngredients: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getIngredients(
          validateMenuMeal(req.params.menuDayId, req.params.mealType),
          requirePrincipal(req),
        ),
        "Định mức thực đơn",
      );
    }),
    saveIngredients: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.saveIngredients(
          validateMenuMeal(req.params.menuDayId, req.params.mealType),
          validateMenuStandards(req.body),
          requirePrincipal(req),
        ),
        "Đã lưu định mức thực đơn",
      );
    }),
    getIngredientOptions: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getIngredientOptions(
          validateMenuIngredientKind(req.params.kind),
          validateMenuListQuery(req.query),
          requirePrincipal(req),
        ),
        "Danh mục nguyên liệu cho thực đơn",
      );
    }),
    getRequirements: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getRequirements(
          validateMenuMeal(req.params.menuDayId, req.params.mealType),
          requirePrincipal(req),
        ),
        "Nhu cầu nguyên liệu theo định mức đã nhập",
      );
    }),
  };
}
