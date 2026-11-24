import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  authorityOfficerService,
  type AuthorityOfficerService,
} from "./authority-officer.service";
import {
  validateAuthorityOfficerCreate,
  validateAuthorityOfficerListQuery,
  validateAuthorityOfficerParams,
} from "./authority-officer.validation";

export function createAuthorityOfficerController(
  service: AuthorityOfficerService = authorityOfficerService,
) {
  return {
    create: asyncHandler(async (req, res) => {
      const body = validateAuthorityOfficerCreate(req.body);
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.create(body, requirePrincipal(req)),
        "Tạo tài khoản ATTP thành công",
        201,
      );
    }),
    list: asyncHandler(async (req, res) => {
      const query = validateAuthorityOfficerListQuery(req.query);
      sendSuccess(
        res,
        await service.list(query, requirePrincipal(req)),
        "Lấy danh sách tài khoản ATTP thành công",
      );
    }),
    getOne: asyncHandler(async (req, res) => {
      const params = validateAuthorityOfficerParams(req.params);
      sendSuccess(
        res,
        await service.getOne(params, requirePrincipal(req)),
        "Lấy chi tiết tài khoản ATTP thành công",
      );
    }),
  };
}
