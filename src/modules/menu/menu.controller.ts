import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendError, sendSuccess } from "../../utils/response";
import { uuid, objectBody } from "../../utils/auth-validation";
import { menuService, type MenuService } from "./menu.service";
import {
  validateApprovalPayload,
  validateMenuId,
  validateMenuListQuery,
  validateRevisionPayload,
  validateMenuMeal,
  validateMenuStandards,
  validateMenuIngredientKind,
  validateMenuWrite,
  validateMenuReview,
  validateMenuFilters,
  validateAllergyCheck,
  validateMenuPortionGroups,
} from "./menu.validation";

function reviewerIdFromRequest(subject: unknown): string | undefined {
  return typeof subject === "string" ? subject : undefined;
}

export function createMenuController(service: MenuService = menuService) {
  return {
    getWeekSchedule: asyncHandler(async (req, res) => {
      const date =
        typeof req.query.date === "string"
          ? req.query.date
          : new Date().toISOString().slice(0, 10);
      sendSuccess(
        res,
        await service.getWeekSchedule(date, requirePrincipal(req)),
      );
    }),
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
    getApprovalDetail: asyncHandler(async (req, res) => {
      const result = await service.getApprovalDetail(
        validateMenuId(req.params.menuId),
        requirePrincipal(req),
      );
      if (!result) {
        sendError(res, "Không tìm thấy thực đơn", 404);
        return;
      }
      sendSuccess(res, result, "Lấy hồ sơ phê duyệt thực đơn thành công");
    }),
    approve: asyncHandler(async (req, res) => {
      const { notes, menuDayId } = validateApprovalPayload(req.body);
      const result = await service.approveMenu(
        validateMenuId(req.params.menuId),
        reviewerIdFromRequest(req.user?.sub),
        notes,
        menuDayId,
      );
      if (!result) {
        sendError(res, "Không tìm thấy thực đơn", 404);
        return;
      }
      sendSuccess(res, result, "Phê duyệt thực đơn thành công");
    }),
    requestRevision: asyncHandler(async (req, res) => {
      const { reason, menuDayId } = validateRevisionPayload(req.body);
      const result = await service.requestRevision(
        validateMenuId(req.params.menuId),
        reviewerIdFromRequest(req.user?.sub),
        reason,
        menuDayId,
      );
      if (!result) {
        sendError(res, "Không tìm thấy thực đơn", 404);
        return;
      }
      sendSuccess(res, result, "Gửi yêu cầu chỉnh sửa thực đơn thành công");
    }),
  };
}
