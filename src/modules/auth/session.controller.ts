import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import { validateLogin } from "./session.validation";
import { sessionService, type SessionService } from "./session.service";
export function createSessionController(
  service: SessionService = sessionService,
) {
  return {
    login: asyncHandler(async (req, res) => {
      const body = validateLogin(req.body as unknown);
      sendSuccess(
        res,
        await service.login(body.identifier, body.password),
        "Đăng nhập thành công",
      );
    }),
    me: asyncHandler((req, res) => {
      sendSuccess(res, requirePrincipal(req));
      return Promise.resolve();
    }),
    permissions: asyncHandler((req, res) => {
      const p = requirePrincipal(req);
      sendSuccess(res, {
        userId: p.id,
        roleId: p.roleId,
        permissions: p.permissions,
      });
      return Promise.resolve();
    }),
  };
}
