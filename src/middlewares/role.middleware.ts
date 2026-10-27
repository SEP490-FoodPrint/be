import type { RequestHandler } from "express";
import { sendError } from "../utils/response";

/**
 * Middleware kiểm tra phân quyền theo vai trò (Role-Based Authorization)
 * @param {Array<string>} allowedRoles - Danh sách các role được phép
 */
export const requireRoles = (
  allowedRoles: readonly string[] = [],
): RequestHandler => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, "Chưa xác thực người dùng", 401);
    }

    if (!allowedRoles || allowedRoles.length === 0) {
      return next();
    }

    const userRole: unknown = req.user.role;
    if (
      typeof userRole !== "string" ||
      !userRole ||
      !allowedRoles.includes(userRole)
    ) {
      return sendError(
        res,
        "Bạn không có quyền thực hiện thao tác này (403)",
        403,
        {
          requiredRoles: allowedRoles,
          currentRole: userRole,
        },
      );
    }

    next();
  };
};

/**
 * Middleware kiểm tra phân hệ tổ chức (Portal Authorization)
 * @param {Array<string>} allowedOrgs - SYSTEM | SCHOOL | SUPPLIER | GOVERNMENT
 */
export const requireOrg = (
  allowedOrgs: readonly string[] = [],
): RequestHandler => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, "Chưa xác thực người dùng", 401);
    }

    if (!allowedOrgs || allowedOrgs.length === 0) {
      return next();
    }

    const userOrg: unknown = req.user.orgType;
    if (
      typeof userOrg !== "string" ||
      !userOrg ||
      !allowedOrgs.includes(userOrg)
    ) {
      return sendError(
        res,
        "Tài khoản không thuộc phân hệ tổ chức này (403)",
        403,
        {
          requiredOrgs: allowedOrgs,
          currentOrg: userOrg,
        },
      );
    }

    next();
  };
};
