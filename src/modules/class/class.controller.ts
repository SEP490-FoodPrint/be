import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { classService, type ClassService } from "./class.service";
import {
  validateClassListQuery,
  validateClassSchoolParams,
  validateClassIdParams,
  validateEligibleTeachersQuery,
  validateHomeroomAssignment,
  validateCreateClass,
  validateUpdateClass,
  validateClassStatus,
  validateCopyClasses,
} from "./class.validation";

export function createClassController(service: ClassService = classService) {
  return {
    getBySchool: asyncHandler(async (req, res) => {
      const params = validateClassSchoolParams(req.params);
      const query = validateClassListQuery(req.query);
      sendSuccess(
        res,
        await service.getBySchool({ params, query }, requirePrincipal(req)),
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateClassListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách lớp học thành công");
    }),
    getAcademicYears: asyncHandler(async (req, res) => {
      sendSuccess(res, await service.getAcademicYears(requirePrincipal(req)));
    }),
    getEligibleTeachers: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getEligibleTeachers(
          validateEligibleTeachersQuery(req.query),
          requirePrincipal(req),
        ),
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
      );
    }),
    removeHomeroomTeacher: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.removeHomeroomTeacher(
          validateClassIdParams(req.params),
          requirePrincipal(req),
        ),
      );
    }),
    createClass: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.createClass(
          validateCreateClass(req.body),
          requirePrincipal(req),
        ),
        "Tạo lớp học thành công",
        201,
      );
    }),
    updateClass: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.updateClass(
          validateClassIdParams(req.params),
          validateUpdateClass(req.body),
          requirePrincipal(req),
        ),
        "Cập nhật lớp học thành công",
      );
    }),
    changeStatus: asyncHandler(async (req, res) => {
      const body = validateClassStatus(req.body);
      sendSuccess(
        res,
        await service.changeStatus(
          validateClassIdParams(req.params),
          body,
          requirePrincipal(req),
        ),
        body.status === "ACTIVE"
          ? "Kích hoạt lại lớp học thành công"
          : "Ngừng hoạt động lớp học thành công",
      );
    }),
    copyClasses: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.copyClasses(
          validateCopyClasses(req.body),
          requirePrincipal(req),
        ),
        "Sao chép danh sách lớp thành công",
        201,
      );
    }),
  };
}
