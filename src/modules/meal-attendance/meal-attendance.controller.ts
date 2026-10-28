import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  mealAttendanceService,
  type MealAttendanceService,
} from "./meal-attendance.service";
import { validateMealAttendanceListQuery } from "./meal-attendance.validation";

export function createMealAttendanceController(
  service: MealAttendanceService = mealAttendanceService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateMealAttendanceListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách suất ăn theo ngày thành công");
    }),
  };
}
