import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  sourceFacilityService,
  type SourceFacilityService,
} from "./source-facility.service";
import { validateSourceFacilityListQuery } from "./source-facility.validation";

export function createSourceFacilityController(
  service: SourceFacilityService = sourceFacilityService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateSourceFacilityListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách cơ sở nguồn gốc thành công");
    }),
  };
}
