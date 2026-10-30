import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import { HttpError } from "../../utils/http-error";
import { getCookie } from "../../utils/cookie";
import { validateLogin } from "./session.validation";
import { sessionService, type SessionService } from "./session.service";

const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 phút
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 ngày

export function createSessionController(
  service: SessionService = sessionService,
) {
  return {
    login: asyncHandler(async (req, res) => {
      const body = validateLogin(req.body as unknown);
      const result = await service.login(body.identifier, body.password);

      const isProduction = process.env.NODE_ENV === "production";

      // Đặt cookie HttpOnly cho Access Token
      res.cookie("access_token", result.accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: ACCESS_TOKEN_MAX_AGE,
      });

      // Đặt cookie HttpOnly cho Refresh Token
      res.cookie("refresh_token", result.refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        path: "/api/auth",
        maxAge: REFRESH_TOKEN_MAX_AGE,
      });

      sendSuccess(
        res,
        {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          user: result.user,
        },
        "Đăng nhập thành công",
      );
    }),

    refresh: asyncHandler(async (req, res) => {
      const cookieToken = getCookie(req, "refresh_token");
      const bodyToken = (req.body as { refreshToken?: string })?.refreshToken;
      const token = cookieToken || bodyToken;

      if (!token || typeof token !== "string") {
        throw new HttpError(401, "Refresh token không tồn tại");
      }

      const result = await service.refreshToken(token);
      const isProduction = process.env.NODE_ENV === "production";

      res.cookie("access_token", result.accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: ACCESS_TOKEN_MAX_AGE,
      });

      res.cookie("refresh_token", result.refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        path: "/api/auth",
        maxAge: REFRESH_TOKEN_MAX_AGE,
      });

      sendSuccess(
        res,
        {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          user: result.user,
        },
        "Làm mới phiên đăng nhập thành công",
      );
    }),

    logout: asyncHandler(async (req, res) => {
      const cookieToken = getCookie(req, "refresh_token");
      const bodyToken = (req.body as { refreshToken?: string })?.refreshToken;
      const token = cookieToken || bodyToken;

      if (token) {
        await service.logout(token).catch(() => {});
      } else if (req.auth?.id) {
        await service.logoutByUserId(req.auth.id).catch(() => {});
      }

      const isProduction = process.env.NODE_ENV === "production";

      res.clearCookie("access_token", {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
      });

      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        path: "/api/auth",
      });

      sendSuccess(res, null, "Đăng xuất thành công");
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
