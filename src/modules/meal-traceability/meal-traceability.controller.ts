import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess, sendError } from "../../utils/response";
import { getGradeMealTraceabilitySchema } from "./meal-traceability.validation";
import { mealTraceabilityService } from "./meal-traceability.service";

export const mealTraceabilityController = {
  getGradeMealTraceability: asyncHandler(async (req, res) => {
    const parsed = getGradeMealTraceabilitySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(
        res,
        "Dữ liệu truy vấn không hợp lệ",
        400,
        parsed.error.flatten().fieldErrors,
      );
      return;
    }

    const result = await mealTraceabilityService.getGradeMealTraceability(
      parsed.data,
    );
    if (!result) {
      sendError(
        res,
        "Chưa có dữ liệu phục vụ bữa ăn của khối vào ngày và bữa đã chọn",
        404,
      );
      return;
    }

    sendSuccess(res, result, "Truy xuất nguồn gốc bữa ăn theo khối thành công");
  }),
};
