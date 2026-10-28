import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  registrationService,
  type RegistrationService,
} from "./registration.service";
import { validateRegistrationListQuery } from "./registration.validation";

export function createRegistrationController(
  service: RegistrationService = registrationService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateRegistrationListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách yêu cầu đăng ký thành công");
    }),
  };
}
