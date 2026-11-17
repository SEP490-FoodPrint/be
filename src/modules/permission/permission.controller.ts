import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  permissionService,
  type PermissionService,
} from "./permission.service";
import {
  validatePermissionUpdate,
  validatePermissionState,
  validatePermissionParams,
  validatePermissionQuery,
  validateInactivePermissionQuery,
  validateRoleQuery,
  validateRoleParams,
  validatePermissionUserParams,
  validateUserPermissionParams,
  validatePermissionEmpty,
  validatePermission,
  validateRolePermissions,
} from "./permission.validation";
export function createPermissionController(
  service: PermissionService = permissionService,
) {
  return {
    update: asyncHandler(async (req, res) => {
      const params = validatePermissionParams(req.params);
      const data = validatePermissionUpdate(req.body as unknown);
      sendSuccess(
        res,
        await service.updatePermission(
          requirePrincipal(req),
          params.permissionId,
          data,
        ),
      );
    }),
    setState: asyncHandler(async (req, res) => {
      const params = validatePermissionParams(req.params);
      const data = validatePermissionState(req.body as unknown);
      sendSuccess(
        res,
        await service.setPermissionState(
          requirePrincipal(req),
          params.permissionId,
          data,
        ),
      );
    }),
    inactive: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.listInactive(
          requirePrincipal(req),
          validateInactivePermissionQuery(req.query),
        ),
      );
    }),
    listRoles: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.listRoles(
          requirePrincipal(req),
          validateRoleQuery(req.query),
        ),
      );
    }),
    list: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.list(
          requirePrincipal(req),
          validatePermissionQuery(req.query),
        ),
      );
    }),
    create: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.create(
          requirePrincipal(req),
          validatePermission(req.body as unknown),
        ),
        "Tạo permission thành công",
        201,
      );
    }),
    role: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.role(
          requirePrincipal(req),
          validateRoleParams(req.params).roleId,
        ),
      );
    }),
    replaceRole: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.replaceRole(
          requirePrincipal(req),
          validateRoleParams(req.params).roleId,
          validateRolePermissions(req.body as unknown),
        ),
      );
    }),
    user: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.user(
          requirePrincipal(req),
          validatePermissionUserParams(req.params).userId,
        ),
      );
    }),
    disable: asyncHandler(async (req, res) => {
      validatePermissionEmpty(req.body as unknown);
      const params = validateUserPermissionParams(req.params);
      sendSuccess(
        res,
        await service.toggle(
          requirePrincipal(req),
          params.userId,
          params.permissionId,
          true,
        ),
      );
    }),
    enable: asyncHandler(async (req, res) => {
      validatePermissionEmpty(req.body as unknown);
      const params = validateUserPermissionParams(req.params);
      sendSuccess(
        res,
        await service.toggle(
          requirePrincipal(req),
          params.userId,
          params.permissionId,
          false,
        ),
      );
    }),
  };
}
