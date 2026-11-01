import { objectBody, text, uuid } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";
export function validatePermission(value: unknown) {
  const body = objectBody(value, [
    "code",
    "name",
    "module",
    "action",
    "description",
  ]);
  const code = text(body.code, 100);
  const module = text(body.module, 80);
  const action = text(body.action, 50);
  if (
    !/^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$/.test(code) ||
    !/^[a-z][a-z0-9_]*$/.test(module) ||
    !/^[a-z][a-z0-9_]*$/.test(action)
  )
    throw new HttpError(400, "Mã permission/module/action không hợp lệ");
  return {
    code,
    module,
    action,
    name: text(body.name, 150),
    description:
      body.description === undefined || body.description === null
        ? null
        : text(body.description, 2000),
  };
}
export function validateRolePermissions(value: unknown): string[] {
  const body = objectBody(value, ["permissionIds"]);
  if (!Array.isArray(body.permissionIds) || body.permissionIds.length > 1000)
    throw new HttpError(400, "permissionIds phải là mảng tối đa 1000 UUID");
  const ids = body.permissionIds.map((id: unknown) => uuid(id));
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, "permissionIds không được trùng");
  return ids;
}
