import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { classService, type ClassService } from "./class.service";
import {
  validateClassListQuery,
  validateClassSchoolParams,
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
  };
}
