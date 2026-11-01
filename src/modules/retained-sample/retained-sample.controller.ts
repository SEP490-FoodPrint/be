import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  retainedSampleService,
  type RetainedSampleService,
} from "./retained-sample.service";
import {
  validateRetainedSampleListQuery,
  validateFoodSample,
  validateSampleDisposal,
} from "./retained-sample.validation";
import { uuid } from "../../utils/auth-validation";

export function createRetainedSampleController(
  service: RetainedSampleService = retainedSampleService,
) {
  return {
    forBatch: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.forBatch(uuid(req.params.id), requirePrincipal(req)),
        ),
    ),
    create: asyncHandler(async (req, res) => {
      const result = await service.create(
        uuid(req.params.id),
        validateFoodSample(req.body),
        requirePrincipal(req),
      );
      sendSuccess(
        res,
        result,
        "Đã ghi nhận lưu mẫu thức ăn",
        result.created ? 201 : 200,
      );
    }),
    dispose: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.dispose(
            uuid(req.params.sampleId),
            validateSampleDisposal(req.body),
            requirePrincipal(req),
          ),
          "Đã ghi nhận tiêu hủy mẫu lưu",
        ),
    ),
    getAll: asyncHandler(async (req, res) => {
      const query = validateRetainedSampleListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách mẫu thức ăn lưu thành công");
    }),
  };
}
