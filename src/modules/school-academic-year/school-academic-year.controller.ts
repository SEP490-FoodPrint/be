import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  schoolAcademicYearService,
  type SchoolAcademicYearService,
} from "./school-academic-year.service";
import {
  validateAcademicYearId,
  validateCreateAcademicYear,
  validateUpdateAcademicYear,
} from "./school-academic-year.validation";

export function createSchoolAcademicYearController(
  service: SchoolAcademicYearService = schoolAcademicYearService,
) {
  return {
    list: asyncHandler(async (req, res) => {
      const result = await service.list(requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách niên khóa thành công");
    }),
    get: asyncHandler(async (req, res) => {
      const result = await service.get(
        validateAcademicYearId(req.params),
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Lấy cấu hình niên khóa thành công");
    }),
    create: asyncHandler(async (req, res) => {
      const result = await service.create(
        validateCreateAcademicYear(req.body),
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Tạo niên khóa thành công", 201);
    }),
    update: asyncHandler(async (req, res) => {
      const result = await service.update(
        validateAcademicYearId(req.params),
        validateUpdateAcademicYear(req.body),
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật niên khóa thành công");
    }),
  };
}
