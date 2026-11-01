import type { Request, RequestHandler } from "express";
import type { AuthPrincipal } from "../types/auth";
import { loadPrincipal } from "../utils/authorization";
import { verifyToken } from "../utils/jwt";
import { uuid } from "../utils/auth-validation";
import { sendError } from "../utils/response";
import { readAccessToken } from "../utils/auth-cookies";
import { authSessions } from "../utils/auth-sessions";
import type { JwtPayload } from "jsonwebtoken";
import type { SessionUser } from "../types/session-user";
import { loadSessionUser } from "../utils/session-identity";

function identityMiddleware<T>(
  load: (id: string) => Promise<T>,
  save: (req: Request, user: T) => void,
  assertSession: (payload: JwtPayload) => Promise<void> = (payload) =>
    authSessions.assertAccess(payload),
): RequestHandler {
  return (req, res, next) => {
    let id: string;
    let payload: JwtPayload;
    try {
      const token = readAccessToken(req);
      if (!token) throw new Error("Missing access token");
      payload = verifyToken(token);
      id = uuid(payload.sub);
    } catch {
      sendError(res, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn", 401);
      return;
    }
    void assertSession(payload)
      .then(() => load(id))
      .then((principal) => {
        save(req, principal);
        next();
      })
      .catch(next);
  };
}

export function createAuthenticate(
  load: (id: string) => Promise<AuthPrincipal> = loadPrincipal,
  assertSession?: (payload: JwtPayload) => Promise<void>,
): RequestHandler {
  return identityMiddleware(
    load,
    (req, principal) => {
      req.auth = principal;
      req.user = {
        sub: principal.id,
        role: principal.role,
        orgType: principal.orgType,
      };
    },
    assertSession,
  );
}

export function createSessionAuthenticate(
  load: (id: string) => Promise<SessionUser> = loadSessionUser,
  assertSession?: (payload: JwtPayload) => Promise<void>,
): RequestHandler {
  return identityMiddleware(
    load,
    (req, user) => {
      req.sessionUser = user;
      if (user.status === "ACTIVE") {
        req.auth = user;
        req.user = { sub: user.id, role: user.role, orgType: user.orgType };
      }
    },
    assertSession,
  );
}
export const authenticate = createAuthenticate();
