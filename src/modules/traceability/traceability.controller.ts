import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  traceabilityService,
  type TraceabilityService,
} from "./traceability.service";
import { validateTraceabilityListQuery } from "./traceability.validation";

export function createTraceabilityController(
  service: TraceabilityService = traceabilityService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateTraceabilityListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(
        res,
        result,
        "Lấy danh sách mốc truy xuất nguồn gốc thành công",
      );
    }),
  };
}
