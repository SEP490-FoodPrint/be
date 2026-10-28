import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  retainedSampleService,
  type RetainedSampleService,
} from "./retained-sample.service";
import { validateRetainedSampleListQuery } from "./retained-sample.validation";

export function createRetainedSampleController(
  service: RetainedSampleService = retainedSampleService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateRetainedSampleListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách mẫu thức ăn lưu thành công");
    }),
  };
}
