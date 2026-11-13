import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { userService, type UserService } from "./user.service";
import {
  validateCreateSchoolAccountBody,
  validateUpdateAccountStatusBody,
  validateUpdateSchoolAccountBody,
  validateUserListQuery,
  validateUserSchoolParams,
  validateUserSchoolUserParams,
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
    getSchoolAccount: asyncHandler(async (req, res) => {
      const params = validateUserSchoolUserParams(req.params);
      const result = await service.getSchoolAccount(
        params,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Lấy thông tin tài khoản thành công");
    }),
    createSchoolAccount: asyncHandler(async (req, res) => {
      const params = validateUserSchoolParams(req.params);
      const body = validateCreateSchoolAccountBody(req.body);
      const result = await service.createSchoolAccount(
        { params, body },
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Tạo tài khoản nhân viên thành công", 201);
    }),
    updateSchoolAccount: asyncHandler(async (req, res) => {
      const params = validateUserSchoolUserParams(req.params);
      const body = validateUpdateSchoolAccountBody(req.body);
      const result = await service.updateSchoolAccount(
        { params, body },
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật thông tin tài khoản thành công");
    }),
    toggleAccountStatus: asyncHandler(async (req, res) => {
      const params = validateUserSchoolUserParams(req.params);
      const body = validateUpdateAccountStatusBody(req.body);
      const result = await service.toggleAccountStatus(
        { params, body },
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật trạng thái tài khoản thành công");
    }),
  };
}
