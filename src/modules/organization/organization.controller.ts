import type { RequestHandler } from "express";
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
  validateMealTimes,
  validateSchoolLogoEnvelope,
  validateSchoolLogoUpload,
  validateDeliveryInspectionRoles,
  validateOrganizationSummaryQuery,
  validateOrganizationDetailParams,
  validateOrganizationListQuery,
  validatePublicDailyMenuQuery,
  validatePublicSchoolQuery,
  validatePublicWeeklyMenuQuery,
  validatePublicSchoolGradesQuery,
  validateSchoolCode,
  validateSchoolId,
} from "./organization.validation";

export function createOrganizationController(
  service: OrganizationService = organizationService,
) {
  return {
    getSummary: asyncHandler(async (req, res) => {
      const q = validateOrganizationSummaryQuery(req.query);
      sendSuccess(res, await service.getSummary(q, requirePrincipal(req)));
    }),
    getById: asyncHandler(async (req, res) => {
      validateOrganizationSummaryQuery(req.query);
      const q = validateOrganizationDetailParams(req.params);
      sendSuccess(res, await service.getById(q, requirePrincipal(req)));
    }),
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
      const input = validateCookingMode(req.body);
      const result = await service.updateCookingMode(
        input,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật chế độ nấu thành công");
    }),

    getSchoolBrand: asyncHandler(async (req, res) => {
      const result = await service.getSchoolBrand(requirePrincipal(req));
      sendSuccess(res, result, "Lấy thông tin trường thành công");
    }),

    // Chạy trước multer: người không có quyền bị chặn trước khi tệp được đọc.
    authorizeSchoolLogo: ((req, _res, next) => {
      try {
        service.authorizeSchoolLogo(requirePrincipal(req));
        next();
      } catch (error) {
        next(error);
      }
    }) as RequestHandler,

    updateSchoolLogo: asyncHandler(async (req, res) => {
      validateSchoolLogoEnvelope(req.body, req.query);
      const files = Array.isArray(req.files) ? req.files : [];
      const result = await service.updateSchoolLogo(
        validateSchoolLogoUpload(files),
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật logo trường thành công");
    }),

    removeSchoolLogo: asyncHandler(async (req, res) => {
      const result = await service.removeSchoolLogo(requirePrincipal(req));
      sendSuccess(res, result, "Đã gỡ logo trường");
    }),

    getMealTimes: asyncHandler(async (req, res) => {
      const result = await service.getMealTimes(requirePrincipal(req));
      sendSuccess(res, result, "Lấy giờ phục vụ bữa ăn thành công");
    }),

    updateMealTimes: asyncHandler(async (req, res) => {
      const result = await service.updateMealTimes(
        validateMealTimes(req.body),
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật giờ phục vụ bữa ăn thành công");
    }),

    getDeliveryInspectionRoles: asyncHandler(async (req, res) => {
      const result = await service.getDeliveryInspectionRoles(
        requirePrincipal(req),
      );
      sendSuccess(
        res,
        result,
        "Lấy cấu hình nhóm duyệt nguyên liệu thành công",
      );
    }),

    updateDeliveryInspectionRoles: asyncHandler(async (req, res) => {
      const input = validateDeliveryInspectionRoles(req.body);
      const result = await service.updateDeliveryInspectionRoles(
        input,
        requirePrincipal(req),
      );
      sendSuccess(
        res,
        result,
        "Cập nhật cấu hình nhóm duyệt nguyên liệu thành công",
      );
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

    getPublicSchoolGrades: asyncHandler(async (req, res) => {
      const schoolCode = validateSchoolCode(req.params.schoolCode);
      const query = validatePublicSchoolGradesQuery(req.query);
      const grades = await service.getPublicSchoolGrades(schoolCode, query);
      sendSuccess(res, grades, "Lấy danh sách khối thành công");
    }),

    getPublicDailyMenu: asyncHandler(async (req, res) => {
      const schoolCode = validateSchoolCode(req.params.schoolCode);
      const query = validatePublicDailyMenuQuery(req.query);
      const result = await service.getPublicDailyMenu(schoolCode, query);
      if (!result) {
        sendSuccess(
          res,
          null,
          "Trường học chưa có thực đơn được công bố cho ngày này",
        );
        return;
      }
      sendSuccess(res, result, "Lấy thực đơn ngày thành công");
    }),

    getPublicWeeklyMenu: asyncHandler(async (req, res) => {
      const schoolCode = validateSchoolCode(req.params.schoolCode);
      const query = validatePublicWeeklyMenuQuery(req.query);
      const result = await service.getPublicWeeklyMenu(schoolCode, query);
      if (!result) {
        sendSuccess(
          res,
          null,
          "Trường học chưa có thực đơn được công bố cho tuần này",
        );
        return;
      }
      sendSuccess(res, result, "Lấy thực đơn tuần thành công");
    }),
  };
}
