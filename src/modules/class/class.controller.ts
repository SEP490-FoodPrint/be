import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { parseAcademicYear } from "./academic-year";
import { classService, type ClassService } from "./class.service";
import {
  validateClassId,
  validateClassListQuery,
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
          parseAcademicYear(req.query.academicYear),
          requirePrincipal(req),
        ),
        "Lấy danh sách GVCN hợp lệ thành công",
      );
    }),
    assignHomeroomTeacher: asyncHandler(async (req, res) => {
      const { teacherUserId } = validateHomeroomAssignment(req.body);
      sendSuccess(
        res,
        await service.assignHomeroomTeacher(
          validateClassId(req.params.classId),
          teacherUserId,
          requirePrincipal(req),
        ),
        "Đã phân công giáo viên chủ nhiệm",
      );
    }),
    removeHomeroomTeacher: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.removeHomeroomTeacher(
          validateClassId(req.params.classId),
          requirePrincipal(req),
        ),
        "Đã bỏ phân công giáo viên chủ nhiệm",
      );
    }),
  };
}
