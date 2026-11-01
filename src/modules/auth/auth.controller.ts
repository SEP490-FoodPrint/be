import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { authService, type AuthService } from "./auth.service";
import { validateAuthListQuery } from "./auth.validation";

export function createAuthController(service: AuthService = authService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateAuthListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách vai trò thành công");
    }),
  };
}
