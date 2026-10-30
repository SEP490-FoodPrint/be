import type { RequestHandler } from "express";
import type { AuthPrincipal } from "../types/auth";
import { loadPrincipal } from "../utils/authorization";
import { verifyToken } from "../utils/jwt";
import { uuid } from "../utils/auth-validation";
import { sendError } from "../utils/response";
import { getCookie } from "../utils/cookie";

export function createAuthenticate(
  load: (id: string) => Promise<AuthPrincipal> = loadPrincipal,
): RequestHandler {
  return (req, res, next) => {
    let id: string;
    try {
      // 1. Ưu tiên đọc Token từ Cookie HttpOnly
      let token = getCookie(req, "access_token");

      // 2. Fallback đọc từ Header Authorization: Bearer <token>
      if (!token) {
        const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
        if (match) {
          token = match[1];
        }
      }

      if (!token) throw new Error("Missing authentication token");
      id = uuid(verifyToken(token).sub);
    } catch {
      sendError(res, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn", 401);
      return;
    }

    void load(id)
      .then((principal) => {
        req.auth = principal;
        req.user = {
          sub: principal.id,
          role: principal.role,
          orgType: principal.orgType,
        };
        next();
      })
      .catch(next);
  };
}

export const authenticate = createAuthenticate();
