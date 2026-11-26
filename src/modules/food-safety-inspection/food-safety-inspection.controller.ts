import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { evidenceFilesOf } from "../../utils/evidence-files";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  foodSafetyInspectionService,
  type FoodSafetyInspectionService,
} from "./food-safety-inspection.service";
import {
  validateCloseFoodSafetyIncident,
  validateFoodSafetyInspectionIncidentParams,
  validateFoodSafetyInspectionParams,
  validatePlanFoodSafetyInspection,
  validateRecordFoodSafetyInspectionResult,
} from "./food-safety-inspection.validation";

/** PR-G: thêm file multipart (trường `files`) vào body trước khi validate. */
const withFiles = (req: Request) => ({
  ...(req.body as Record<string, unknown>),
  files: evidenceFilesOf(req.files),
});

function privateResult(
  res: Response,
  result: unknown,
  message: string,
  status = 200,
) {
  res.setHeader("Cache-Control", "private, no-store");
  sendSuccess(res, result, message, status);
}

export function createFoodSafetyInspectionController(
  service: FoodSafetyInspectionService = foodSafetyInspectionService,
) {
  return {
    getSupplierOptions: asyncHandler(async (req, res) => {
      const { id } = validateFoodSafetyInspectionIncidentParams(req.params);
      privateResult(
        res,
        await service.getSupplierOptions(id, requirePrincipal(req)),
        "Lấy danh sách NCC được kết luận thành công",
      );
    }),
    plan: asyncHandler(async (req, res) => {
      const { id } = validateFoodSafetyInspectionIncidentParams(req.params);
      privateResult(
        res,
        await service.plan(
          id,
          validatePlanFoodSafetyInspection(req.body),
          requirePrincipal(req),
        ),
        "Đã lập đợt kiểm tra",
        201,
      );
    }),
    recordResult: asyncHandler(async (req, res) => {
      const { id, inspectionId } = validateFoodSafetyInspectionParams(
        req.params,
      );
      privateResult(
        res,
        await service.recordResult(
          id,
          inspectionId,
          validateRecordFoodSafetyInspectionResult(withFiles(req)),
          requirePrincipal(req),
        ),
        "Đã ghi kết quả kiểm tra",
      );
    }),
    close: asyncHandler(async (req, res) => {
      const { id } = validateFoodSafetyInspectionIncidentParams(req.params);
      privateResult(
        res,
        await service.close(
          id,
          validateCloseFoodSafetyIncident(req.body),
          requirePrincipal(req),
        ),
        "Đã đóng hồ sơ sự cố",
      );
    }),
  };
}
