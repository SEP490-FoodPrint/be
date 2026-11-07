import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { classService, type ClassService } from "./class.service";
import {
  validateClassIdParams,
  validateClassListQuery,
  validateEligibleTeachersQuery,
  validateHomeroomAssignment,
} from "./class.validation";

export function createClassController(service: ClassService = classService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateClassListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách lớp học thành công");
    }),
    getAcademicYears: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getAcademicYears(requirePrincipal(req)),
        "Lấy danh sách niên khóa thành công",
      );
    }),
    getEligibleTeachers: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getEligibleTeachers(
          validateEligibleTeachersQuery(req.query),
          requirePrincipal(req),
        ),
        "Lấy danh sách GVCN hợp lệ thành công",
      );
    }),
    assignHomeroomTeacher: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.assignHomeroomTeacher(
          validateClassIdParams(req.params),
          validateHomeroomAssignment(req.body),
          requirePrincipal(req),
        ),
        "Đã phân công giáo viên chủ nhiệm",
      );
    }),
    removeHomeroomTeacher: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.removeHomeroomTeacher(
          validateClassIdParams(req.params),
          requirePrincipal(req),
        ),
        "Đã bỏ phân công giáo viên chủ nhiệm",
      );
    }),
  };
}
