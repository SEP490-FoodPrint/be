import type { Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  supplierEnforcementService,
  type SupplierEnforcementService,
} from "./supplier-enforcement.service";
import {
  validateApproveEnforcement,
  validateEnforcementActionParams,
  validateEnforcementIncidentParams,
  validateEnforcementListQuery,
  validateRejectEnforcement,
  validateRequestEnforcement,
} from "./supplier-enforcement.validation";

function privateResult(
  res: Response,
  result: unknown,
  message: string,
  status = 200,
) {
  res.setHeader("Cache-Control", "private, no-store");
  sendSuccess(res, result, message, status);
}

export function createSupplierEnforcementController(
  service: SupplierEnforcementService = supplierEnforcementService,
) {
  return {
    request: asyncHandler(async (req, res) => {
      const { id } = validateEnforcementIncidentParams(req.params);
      privateResult(
        res,
        await service.request(
          id,
          validateRequestEnforcement(req.body),
          requirePrincipal(req),
        ),
        "Đã gửi đề nghị chế tài NCC",
        201,
      );
    }),
    list: asyncHandler(async (req, res) => {
      privateResult(
        res,
        await service.list(
          validateEnforcementListQuery(req.query),
          requirePrincipal(req),
        ),
        "Lấy danh sách yêu cầu chế tài thành công",
      );
    }),
    getOne: asyncHandler(async (req, res) => {
      const { actionId } = validateEnforcementActionParams(req.params);
      privateResult(
        res,
        await service.getOne(actionId, requirePrincipal(req)),
        "Lấy chi tiết yêu cầu chế tài thành công",
      );
    }),
    approve: asyncHandler(async (req, res) => {
      const { actionId } = validateEnforcementActionParams(req.params);
      privateResult(
        res,
        await service.approve(
          actionId,
          validateApproveEnforcement(req.body),
          requirePrincipal(req),
        ),
        "Đã duyệt và thực thi yêu cầu chế tài",
      );
    }),
    reject: asyncHandler(async (req, res) => {
      const { actionId } = validateEnforcementActionParams(req.params);
      privateResult(
        res,
        await service.reject(
          actionId,
          validateRejectEnforcement(req.body),
          requirePrincipal(req),
        ),
        "Đã từ chối yêu cầu chế tài",
      );
    }),
    retry: asyncHandler(async (req, res) => {
      const { actionId } = validateEnforcementActionParams(req.params);
      privateResult(
        res,
        await service.retry(actionId, requirePrincipal(req)),
        "Đã chạy lại thu hồi phiên đăng nhập",
      );
    }),
  };
}
