import { sendError } from "../utils/response.js"

/**
 * Middleware kiểm tra phân quyền theo vai trò (Role-Based Authorization)
 * @param {Array<string>} allowedRoles - Danh sách các role được phép
 */
export const requireRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, "Chưa xác thực người dùng", 401)
    }

    if (!allowedRoles || allowedRoles.length === 0) {
      return next()
    }

    const userRole = req.user.role
    if (!userRole || !allowedRoles.includes(userRole)) {
      return sendError(res, "Bạn không có quyền thực hiện thao tác này (403)", 403, {
        requiredRoles: allowedRoles,
        currentRole: userRole,
      })
    }

    next()
  }
}

/**
 * Middleware kiểm tra phân hệ tổ chức (Portal Authorization)
 * @param {Array<string>} allowedOrgs - SYSTEM | SCHOOL | SUPPLIER
 */
export const requireOrg = (allowedOrgs = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, "Chưa xác thực người dùng", 401)
    }

    if (!allowedOrgs || allowedOrgs.length === 0) {
      return next()
    }

    const userOrg = req.user.orgType
    if (!userOrg || !allowedOrgs.includes(userOrg)) {
      return sendError(res, "Tài khoản không thuộc phân hệ tổ chức này (403)", 403, {
        requiredOrgs: allowedOrgs,
        currentOrg: userOrg,
      })
    }

    next()
  }
}
