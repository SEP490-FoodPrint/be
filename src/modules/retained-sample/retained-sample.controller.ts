import { requirePrincipal } from "../../utils/authorization";
import { uploadRecordPhoto, removeRecordPhoto } from "../../utils/record-photo";
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
      const id = uuid(req.params.id);
      const input = validateFoodSample(req.body);
      const principal = requirePrincipal(req);
      const upload = await uploadRecordPhoto(principal.id, req.file);
      let result;
      try {
        result = await service.create(id, input, principal, upload?.photo);
      } catch (error) {
        if (upload) await removeRecordPhoto(upload.document);
        throw error;
      }
      if (upload && !result.created) await removeRecordPhoto(upload.document);
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
