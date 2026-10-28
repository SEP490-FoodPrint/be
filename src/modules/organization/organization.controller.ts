import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  organizationService,
  type OrganizationService,
} from "./organization.service";
import { validateOrganizationListQuery } from "./organization.validation";

export function createOrganizationController(
  service: OrganizationService = organizationService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateOrganizationListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách trường học thành công");
    }),
  };
}
