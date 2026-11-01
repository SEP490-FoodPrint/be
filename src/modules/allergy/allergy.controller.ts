import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { allergyService, type AllergyService } from "./allergy.service";
import { validateAllergyListQuery } from "./allergy.validation";

export function createAllergyController(
  service: AllergyService = allergyService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateAllergyListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách dị ứng theo lớp thành công");
    }),
  };
}
