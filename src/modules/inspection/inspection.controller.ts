import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  inspectionService,
  type InspectionService,
} from "./inspection.service";
import { validateInspectionListQuery } from "./inspection.validation";

export function createInspectionController(
  service: InspectionService = inspectionService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateInspectionListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(
        res,
        result,
        "Lấy danh sách sự cố an toàn thực phẩm thành công",
      );
    }),
  };
}
