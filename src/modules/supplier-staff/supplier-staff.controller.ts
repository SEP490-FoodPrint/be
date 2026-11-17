import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  supplierStaffService,
  type SupplierStaffService,
} from "./supplier-staff.service";
import {
  validateSupplierStaffPermissionParams,
  validateSupplierStaffStatus,
  validateSupplierStaffCreate,
  validateSupplierStaffParams,
  validateSupplierStaffQuery,
  validateSupplierStaffEmpty,
} from "./supplier-staff.validation";

export function createSupplierStaffController(
  service: SupplierStaffService = supplierStaffService,
) {
  return {
    getPermissions: asyncHandler(async (req, res) => {
      const params = validateSupplierStaffParams(req.params);
      validateSupplierStaffEmpty(req.query);
      validateSupplierStaffEmpty(req.body);
      sendSuccess(
        res,
        await service.getPermissions(params, requirePrincipal(req)),
        "Lấy quyền nhân viên thành công",
      );
    }),
    disablePermission: asyncHandler(async (req, res) => {
      const params = validateSupplierStaffPermissionParams(req.params);
      validateSupplierStaffEmpty(req.query);
      validateSupplierStaffEmpty(req.body);
      sendSuccess(
        res,
        await service.togglePermission(params, true, requirePrincipal(req)),
        "Tắt quyền nhân viên thành công",
      );
    }),
    enablePermission: asyncHandler(async (req, res) => {
      const params = validateSupplierStaffPermissionParams(req.params);
      validateSupplierStaffEmpty(req.query);
      validateSupplierStaffEmpty(req.body);
      sendSuccess(
        res,
        await service.togglePermission(params, false, requirePrincipal(req)),
        "Bật lại quyền nhân viên thành công",
      );
    }),
    changeStatus: asyncHandler(async (req, res) => {
      const params = validateSupplierStaffParams(req.params);
      validateSupplierStaffEmpty(req.query);
      const input = validateSupplierStaffStatus(req.body);
      sendSuccess(
        res,
        await service.changeStatus(params, input, requirePrincipal(req)),
        "Cập nhật trạng thái tài khoản thành công",
      );
    }),
    create: asyncHandler(async (req, res) => {
      validateSupplierStaffEmpty(req.query);
      const input = validateSupplierStaffCreate(req.body);
      sendSuccess(
        res,
        await service.create(input, requirePrincipal(req)),
        "Tạo tài khoản nhân viên thành công",
        201,
      );
    }),
    getDetail: asyncHandler(async (req, res) => {
      const params = validateSupplierStaffParams(req.params);
      validateSupplierStaffEmpty(req.query);
      validateSupplierStaffEmpty(req.body);
      sendSuccess(
        res,
        await service.getDetail(params, requirePrincipal(req)),
        "Lấy thông tin nhân viên thành công",
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateSupplierStaffQuery(req.query);
      validateSupplierStaffEmpty(req.body);
      sendSuccess(
        res,
        await service.getAll(query, requirePrincipal(req)),
        "Lấy danh sách nhân viên thành công",
      );
    }),
  };
}
