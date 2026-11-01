import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { classService, type ClassService } from "./class.service";
import { validateClassListQuery } from "./class.validation";

export function createClassController(service: ClassService = classService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateClassListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách lớp học thành công");
    }),
  };
}
