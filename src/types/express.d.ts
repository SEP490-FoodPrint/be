import type { AuthPrincipal } from "./auth";
import type { SessionUser } from "./session-user";
import type { JwtPayload } from "jsonwebtoken";

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
    auth?: AuthPrincipal;
    sessionUser?: SessionUser;
  }
}

export {};
