import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess, sendError } from "../../utils/response";
import { getMealTraceabilitySchema } from "./meal-traceability.validation";
import { mealTraceabilityService } from "./meal-traceability.service";

export const mealTraceabilityController = {
  getMealTraceability: asyncHandler(async (req, res) => {
    const parsed = getMealTraceabilitySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(
        res,
        "Dữ liệu truy vấn không hợp lệ",
        400,
        parsed.error.flatten().fieldErrors,
      );
      return;
    }

    const result = await mealTraceabilityService.getMealTraceability(
      parsed.data,
    );
    if (!result) {
      sendError(
        res,
        "Không tìm thấy dữ liệu phân bổ suất ăn theo điều kiện tra cứu",
        404,
      );
      return;
    }

    sendSuccess(res, result, "Truy xuất nguồn gốc suất ăn thành công");
  }),
};
