import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  mealAttendanceService,
  type MealAttendanceService,
} from "./meal-attendance.service";
import {
  validateMealAttendanceListQuery,
  validateMealSummaryQuery,
  validateDailyPortionGroups,
  validateDailyMealPortion,
  validateMyClassMealQuery,
} from "./meal-attendance.validation";
import { uuid } from "../../utils/auth-validation";

export function createMealAttendanceController(
  service: MealAttendanceService = mealAttendanceService,
) {
  return {
    getMyClass: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getMyClass(
          validateMyClassMealQuery(req.query),
          requirePrincipal(req),
        ),
      );
    }),
    saveDraft: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.saveDraft(
          validateDailyMealPortion(req.body),
          requirePrincipal(req),
        ),
        "Đã lưu nháp số suất ăn của lớp",
      );
    }),
    finalize: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.finalize(uuid(req.params.id), requirePrincipal(req)),
        "Đã chốt số suất ăn của lớp",
      );
    }),
    getPortionGroups: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getPortionGroups(
          uuid(req.params.id),
          requirePrincipal(req),
        ),
      );
    }),
    savePortionGroups: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.savePortionGroups(
          uuid(req.params.id),
          validateDailyPortionGroups(req.body),
          requirePrincipal(req),
        ),
        "Đã chốt số suất nhóm không trùng của lớp",
      );
    }),
    summary: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.summary(
          validateMealSummaryQuery(req.query),
          requirePrincipal(req),
        ),
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateMealAttendanceListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách suất ăn theo ngày thành công");
    }),
  };
}
