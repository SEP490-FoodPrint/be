import { asyncHandler } from "../../utils/async-handler";
import { requireSessionUser } from "../../utils/session-identity";
import { sendSuccess } from "../../utils/response";
import { validateLogin } from "./session.validation";
import { validateSignup } from "./signup.validation";
import { signupService, type SignupService } from "./signup.service";
import {
  clearAuthCookies,
  readAccessToken,
  readAuthCookie,
  REFRESH_COOKIE,
  setAuthCookies,
} from "../../utils/auth-cookies";
import { sessionService, type SessionService } from "./session.service";
export function createSessionController(
  service: SessionService = sessionService,
  registration: SignupService = signupService,
) {
  return {
    login: asyncHandler(async (req, res) => {
      const body = validateLogin(req.body as unknown);
      const result = await service.login(
        body.identifier,
        body.password,
        readAuthCookie(req, REFRESH_COOKIE),
      );
      setAuthCookies(res, result);
      sendSuccess(
        res,
        { user: result.user, expiresIn: result.accessTtlSeconds },
        "Đăng nhập thành công",
      );
    }),
    signup: asyncHandler(async (req, res) => {
      const result = await registration.signup(
        validateSignup(req.body as unknown),
        req.ip,
      );
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        result,
        result.verificationEmailSent
          ? "Đăng ký thành công; kiểm tra email để xác minh tài khoản"
          : "Đã tạo tài khoản; chưa gửi được mã xác minh, vui lòng yêu cầu gửi lại",
        201,
      );
    }),
    refresh: asyncHandler(async (req, res) => {
      try {
        const result = await service.refresh(
          readAuthCookie(req, REFRESH_COOKIE),
        );
        setAuthCookies(res, result);
        sendSuccess(
          res,
          { user: result.user, expiresIn: result.accessTtlSeconds },
          "Làm mới phiên thành công",
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          [401, 403].includes(Number(error.statusCode))
        )
          clearAuthCookies(res);
        throw error;
      }
    }),
    logout: asyncHandler(async (req, res) => {
      try {
        await service.logout(
          readAuthCookie(req, REFRESH_COOKIE),
          readAccessToken(req),
        );
      } finally {
        clearAuthCookies(res);
      }
      sendSuccess(res, null, "Đăng xuất thành công");
    }),
    me: asyncHandler((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(res, requireSessionUser(req));
      return Promise.resolve();
    }),

    permissions: asyncHandler((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const p = requireSessionUser(req);
      sendSuccess(res, {
        userId: p.id,
        roleId: p.roleId,
        permissions: p.status === "ACTIVE" ? p.permissions : [],
      });
      return Promise.resolve();
    }),
  };
}
