import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { userService, type UserService } from "./user.service";
import { validateUserListQuery } from "./user.validation";

export function createUserController(service: UserService = userService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateUserListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách người dùng thành công");
    }),
  };
}
