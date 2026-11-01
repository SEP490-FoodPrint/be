import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  schoolAlertService,
  type SchoolAlertService,
} from "./school-alert.service";
import { validateSchoolAlertListQuery } from "./school-alert.validation";

export function createSchoolAlertController(
  service: SchoolAlertService = schoolAlertService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateSchoolAlertListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách cảnh báo sự cố đến trường thành công",
      );
    }),
  };
}
