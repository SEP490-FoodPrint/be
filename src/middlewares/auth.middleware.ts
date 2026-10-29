import type { RequestHandler } from "express";
import type { AuthPrincipal } from "../types/auth";
import { loadPrincipal } from "../utils/authorization";
import { verifyToken } from "../utils/jwt";
import { uuid } from "../utils/auth-validation";
import { sendError } from "../utils/response";
export function createAuthenticate(
  load: (id: string) => Promise<AuthPrincipal> = loadPrincipal,
): RequestHandler {
  return (req, res, next) => {
    let id: string;
    try {
      const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
      if (!match) throw new Error("Missing bearer token");
      id = uuid(verifyToken(match[1]).sub);
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
