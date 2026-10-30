import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { reportingService, type ReportingService } from "./reporting.service";
import { validateReportingListQuery } from "./reporting.validation";

export function createReportingController(
  service: ReportingService = reportingService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateReportingListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách chuyển tiếp báo cáo sự cố thành công",
      );
    }),
  };
}
