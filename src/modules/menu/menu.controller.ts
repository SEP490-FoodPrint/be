import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { uuid, objectBody } from "../../utils/auth-validation";
import { menuService, type MenuService } from "./menu.service";
import {
  validateMenuListQuery,
  validateMenuMeal,
  validateMenuStandards,
  validateMenuIngredientKind,
  validateMenuWrite,
  validateMenuReview,
  validateMenuFilters,
  validateAllergyCheck,
  validateMenuPortionGroups,
} from "./menu.validation";

export function createMenuController(service: MenuService = menuService) {
  return {
    getPortionGroups: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getPortionGroups(
          validateMenuMeal(req.params.menuDayId, req.params.mealType),
          requirePrincipal(req),
        ),
      );
    }),
    savePortionGroups: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.savePortionGroups(
          validateMenuMeal(req.params.menuDayId, req.params.mealType),
          validateMenuPortionGroups(req.body),
          requirePrincipal(req),
        ),
        "Đã lưu nhóm suất và các món do y tế chọn",
      );
    }),
    list: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.list(
            validateMenuFilters(req.query),
            requirePrincipal(req),
          ),
        ),
    ),
    getOne: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.getOne(uuid(req.params.menuId), requirePrincipal(req)),
        ),
    ),
    create: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.create(
            validateMenuWrite(req.body),
            requirePrincipal(req),
          ),
          "Đã tạo thực đơn nháp",
          201,
        ),
    ),
    update: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.update(
            uuid(req.params.menuId),
            validateMenuWrite(req.body),
            requirePrincipal(req),
          ),
          "Đã cập nhật thực đơn",
        ),
    ),
    remove: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.remove(uuid(req.params.menuId), requirePrincipal(req)),
          "Đã xóa thực đơn nháp",
        ),
    ),
    submit: asyncHandler(async (req, res) => {
      objectBody(req.body ?? {}, []);
      sendSuccess(
        res,
        await service.submit(uuid(req.params.menuId), requirePrincipal(req)),
        "Đã gửi thực đơn chờ duyệt",
      );
    }),
    review: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.review(
            uuid(req.params.menuId),
            validateMenuReview(req.body),
            requirePrincipal(req),
          ),
          "Đã ghi nhận kết quả duyệt",
        ),
    ),
    getReviews: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.getReviews(
            uuid(req.params.menuId),
            requirePrincipal(req),
            validateMenuListQuery(req.query),
          ),
        ),
    ),
    allergyCheck: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.allergyCheck(
            validateAllergyCheck(req.body),
            requirePrincipal(req),
          ),
        ),
    ),
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
          validateMenuListQuery({ limit: "50", ...req.query }),
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
