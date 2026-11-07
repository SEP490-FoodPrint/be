import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { userService, type UserService } from "./user.service";
import {
  validateUserListQuery,
  validateUserSchoolParams,
} from "./user.validation";

export function createUserController(service: UserService = userService) {
  return {
    getBySchool: asyncHandler(async (req, res) => {
      const params = validateUserSchoolParams(req.params);
      const query = validateUserListQuery(req.query);
      sendSuccess(
        res,
        await service.getBySchool({ params, query }, requirePrincipal(req)),
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateUserListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách người dùng thành công");
    }),
  };
}
