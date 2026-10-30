import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { uuid } from "../../utils/auth-validation";
import { parseListQuery } from "../../utils/list-query";
import { sendSuccess } from "../../utils/response";
import {
  permissionService,
  type PermissionService,
} from "./permission.service";
import {
  validatePermission,
  validateRolePermissions,
} from "./permission.validation";
export function createPermissionController(
  service: PermissionService = permissionService,
) {
  return {
    list: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.list(requirePrincipal(req), parseListQuery(req.query)),
      );
    }),
    create: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.create(
          requirePrincipal(req).id,
          validatePermission(req.body as unknown),
        ),
        "Tạo permission thành công",
        201,
      );
    }),
    role: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.role(requirePrincipal(req), uuid(req.params.roleId)),
      );
    }),
    replaceRole: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.replaceRole(
          requirePrincipal(req).id,
          uuid(req.params.roleId),
          validateRolePermissions(req.body as unknown),
        ),
      );
    }),
    user: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.user(requirePrincipal(req), uuid(req.params.userId)),
      );
    }),
    disable: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.toggle(
          requirePrincipal(req).id,
          uuid(req.params.userId),
          uuid(req.params.permissionId),
          true,
        ),
      );
    }),
    enable: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.toggle(
          requirePrincipal(req).id,
          uuid(req.params.userId),
          uuid(req.params.permissionId),
          false,
        ),
      );
    }),
  };
}
