import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendError, sendSuccess } from "../../utils/response";
import {
  organizationService,
  type OrganizationService,
} from "./organization.service";
import { validateOrganizationListQuery } from "./organization.validation";

export function createOrganizationController(
  service: OrganizationService = organizationService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateOrganizationListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách trường học thành công");
    }),

    getPublicSchools: asyncHandler(async (req, res) => {
      const search =
        typeof req.query.search === "string" ? req.query.search : undefined;
      const locationId =
        typeof req.query.locationId === "string"
          ? req.query.locationId
          : undefined;
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      const result = await service.getPublicSchools({
        search,
        locationId,
        page,
        limit,
      });
      sendSuccess(res, result.data, "Lấy danh sách trường học thành công");
    }),

    getPublicSchoolByCode: asyncHandler(async (req, res) => {
      const code = req.params.code;
      if (!code) {
        sendError(res, "Thiếu mã trường học", 400);
        return;
      }
      const school = await service.getPublicSchoolByCode(code);
      if (!school) {
        sendError(res, `Không tìm thấy trường học với mã: ${code}`, 404);
        return;
      }
      sendSuccess(res, school, "Lấy chi tiết trường học thành công");
    }),

    getPublicSchoolById: asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!id) {
        sendError(res, "Thiếu ID trường học", 400);
        return;
      }
      const school = await service.getPublicSchoolById(id);
      if (!school) {
        sendError(res, `Không tìm thấy trường học với ID: ${id}`, 404);
        return;
      }
      sendSuccess(res, school, "Lấy chi tiết trường học thành công");
    }),
  };
}
