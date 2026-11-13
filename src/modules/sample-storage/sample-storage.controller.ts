import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  sampleStorageService,
  type SampleStorageService,
} from "./sample-storage.service";
import {
  validateSampleStorageQuery,
  validateSampleStorageWrite,
} from "./sample-storage.validation";

export function createSampleStorageController(
  service: SampleStorageService = sampleStorageService,
) {
  return {
    list: asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const query = validateSampleStorageQuery(req.query);
      const result = await service.list(principal, query);
      sendSuccess(res, result, "Lấy danh sách tủ lưu mẫu thành công");
    }),

    getById: asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const { id } = req.params;
      const result = await service.getById(principal, id);
      sendSuccess(res, result, "Lấy thông tin chi tiết tủ lưu mẫu thành công");
    }),

    create: asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const input = validateSampleStorageWrite(req.body);
      const result = await service.create(principal, input);
      sendSuccess(res, result, "Thêm mới tủ lưu mẫu thành công", 201);
    }),

    update: asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const { id } = req.params;
      const input = validateSampleStorageWrite(req.body);
      const result = await service.update(principal, id, input);
      sendSuccess(res, result, "Cập nhật thông tin tủ lưu mẫu thành công");
    }),

    remove: asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const { id } = req.params;
      const result = await service.delete(principal, id);
      sendSuccess(res, result, "Xóa tủ lưu mẫu thành công");
    }),
  };
}

export const sampleStorageController = createSampleStorageController();
