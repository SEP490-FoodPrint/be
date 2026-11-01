import type { RequestHandler } from "express";
import { assertPermission, requirePrincipal } from "../utils/authorization";
import { listScopes, type Resource } from "../utils/resource-access";

export function requirePermission(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      assertPermission(requirePrincipal(req), ...codes);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireResource(resource: Resource): RequestHandler {
  return (req, _res, next) => {
    try {
      listScopes[resource](requirePrincipal(req));
      next();
    } catch (error) {
      next(error);
    }
  };
}
