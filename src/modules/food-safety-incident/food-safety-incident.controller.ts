import type { Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  foodSafetyIncidentService,
  type FoodSafetyIncidentService,
} from "./food-safety-incident.service";
import {
  validateAddFoodSafetyIncidentAllocations,
  validateCancelFoodSafetyIncident,
  validateDirectFoodSafetyIncident,
  validateFoodSafetyIncidentListQuery,
  validateFoodSafetyIncidentParams,
  validateFoodSafetyIncidentSnapshotParams,
  validateForwardFoodSafetyIncident,
  validateReportFoodSafetyIncident,
} from "./food-safety-incident.validation";

function privateResult(
  res: Response,
  result: unknown,
  message: string,
  status = 200,
) {
  res.setHeader("Cache-Control", "private, no-store");
  sendSuccess(res, result, message, status);
}

export function createFoodSafetyIncidentController(
  service: FoodSafetyIncidentService = foodSafetyIncidentService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      privateResult(
        res,
        await service.getAll(
          validateFoodSafetyIncidentListQuery(req.query),
          requirePrincipal(req),
        ),
        "Lấy danh sách sự cố an toàn thực phẩm thành công",
      );
    }),
    getOne: asyncHandler(async (req, res) => {
      const { id } = validateFoodSafetyIncidentParams(req.params);
      privateResult(
        res,
        await service.getOne(id, requirePrincipal(req)),
        "Lấy chi tiết sự cố an toàn thực phẩm thành công",
      );
    }),
    getTraceSnapshot: asyncHandler(async (req, res) => {
      const { id, version } = validateFoodSafetyIncidentSnapshotParams(
        req.params,
      );
      privateResult(
        res,
        await service.getTraceSnapshot(id, version, requirePrincipal(req)),
        "Lấy snapshot truy xuất thành công",
      );
    }),
    report: asyncHandler(async (req, res) => {
      privateResult(
        res,
        await service.report(
          validateReportFoodSafetyIncident(req.body),
          requirePrincipal(req),
        ),
        "Đã gửi báo cáo sự cố tới Ban Giám hiệu",
        201,
      );
    }),
    createDirect: asyncHandler(async (req, res) => {
      privateResult(
        res,
        await service.createDirect(
          validateDirectFoodSafetyIncident(req.body),
          requirePrincipal(req),
        ),
        "Đã lập hồ sơ sự cố và gửi ATTP",
        201,
      );
    }),
    forward: asyncHandler(async (req, res) => {
      const { id } = validateFoodSafetyIncidentParams(req.params);
      privateResult(
        res,
        await service.forward(
          id,
          validateForwardFoodSafetyIncident(req.body),
          requirePrincipal(req),
        ),
        "Đã chuyển hồ sơ sự cố lên ATTP",
      );
    }),
    cancel: asyncHandler(async (req, res) => {
      const { id } = validateFoodSafetyIncidentParams(req.params);
      privateResult(
        res,
        await service.cancel(
          id,
          validateCancelFoodSafetyIncident(req.body),
          requirePrincipal(req),
        ),
        "Đã hủy hồ sơ sự cố",
      );
    }),
    addAllocations: asyncHandler(async (req, res) => {
      const { id } = validateFoodSafetyIncidentParams(req.params);
      privateResult(
        res,
        await service.addAllocations(
          id,
          validateAddFoodSafetyIncidentAllocations(req.body),
          requirePrincipal(req),
        ),
        "Đã gắn suất ăn vào hồ sơ sự cố",
      );
    }),
  };
}
