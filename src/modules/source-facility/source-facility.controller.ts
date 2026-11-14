import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  sourceFacilityService,
  type SourceFacilityService,
} from "./source-facility.service";
import {
  validateSourceFacilityListQuery,
  validateSourceFacilityCreate,
  validateSourceFacilityParams,
  validateSourceFacilityUpdate,
  validateSourceFacilityDeactivate,
} from "./source-facility.validation";

export function createSourceFacilityController(
  service: SourceFacilityService = sourceFacilityService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateSourceFacilityListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách cơ sở nguồn gốc thành công");
    }),
    create: asyncHandler(async (req, res) => {
      const input = validateSourceFacilityCreate(req.body);
      const result = await service.create(input, requirePrincipal(req));
      sendSuccess(res, result, "Thêm cơ sở cung cấp thành công", 201);
    }),
    getDetail: asyncHandler(async (req, res) => {
      const params = validateSourceFacilityParams(req.params);
      const result = await service.getDetail(params, requirePrincipal(req));
      sendSuccess(res, result, "Lấy chi tiết cơ sở cung cấp thành công");
    }),
    update: asyncHandler(async (req, res) => {
      const params = validateSourceFacilityParams(req.params);
      const input = validateSourceFacilityUpdate(req.body);
      const result = await service.update(params, input, requirePrincipal(req));
      sendSuccess(res, result, "Cập nhật cơ sở cung cấp thành công");
    }),
    deactivate: asyncHandler(async (req, res) => {
      const params = validateSourceFacilityParams(req.params);
      const input = validateSourceFacilityDeactivate(req.body);
      const result = await service.deactivate(
        params,
        input,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Dừng hoạt động cơ sở cung cấp thành công");
    }),
  };
}
