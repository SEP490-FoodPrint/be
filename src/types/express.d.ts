import type { AuthPrincipal } from "./auth";
import type { JwtPayload } from "jsonwebtoken";

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
    auth?: AuthPrincipal;
  }
}

export {};
