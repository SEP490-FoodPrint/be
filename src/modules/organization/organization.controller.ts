import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { HttpError } from "../../utils/http-error";
import {
  organizationService,
  type OrganizationService,
} from "./organization.service";
import {
  validateCookingMode,
  validateOrganizationListQuery,
  validatePublicSchoolQuery,
  validateSchoolCode,
  validateSchoolId,
} from "./organization.validation";

export function createOrganizationController(
  service: OrganizationService = organizationService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateOrganizationListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách trường học thành công");
    }),

    getCookingMode: asyncHandler(async (req, res) => {
      const result = await service.getCookingMode(requirePrincipal(req));
      sendSuccess(res, result, "Lấy chế độ nấu thành công");
    }),

    updateCookingMode: asyncHandler(async (req, res) => {
      const cookingMode = validateCookingMode(req.body);
      const result = await service.updateCookingMode(
        cookingMode,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật chế độ nấu thành công");
    }),

    getPublicSchools: asyncHandler(async (req, res) => {
      const query = validatePublicSchoolQuery(req.query);
      const result = await service.getPublicSchools(query);
      sendSuccess(res, result, "Lấy danh sách trường học thành công");
    }),

    getPublicSchoolByCode: asyncHandler(async (req, res) => {
      const code = validateSchoolCode(req.params.code);
      const school = await service.getPublicSchoolByCode(code);
      if (!school) {
        throw new HttpError(404, `Không tìm thấy trường học với mã: ${code}`);
      }
      sendSuccess(res, school, "Lấy chi tiết trường học thành công");
    }),

    getPublicSchoolById: asyncHandler(async (req, res) => {
      const id = validateSchoolId(req.params.id);
      const school = await service.getPublicSchoolById(id);
      if (!school) {
        throw new HttpError(404, `Không tìm thấy trường học với ID: ${id}`);
      }
      sendSuccess(res, school, "Lấy chi tiết trường học thành công");
    }),

    getPublicLocations: asyncHandler(async (_req, res) => {
      const locations = await service.getPublicLocations();
      sendSuccess(res, locations, "Lấy danh mục địa điểm thành công");
    }),
  };
}
