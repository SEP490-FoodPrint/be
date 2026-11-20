import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import type { MeasurementUnitService } from "./measurement-unit.service";
import {
  validateUnitQuery,
  validateUnitParams,
  validateUnitCreate,
  validateUnitUpdate,
} from "./measurement-unit.validation";
export function createMeasurementUnitController(
  service: MeasurementUnitService,
) {
  return {
    list: asyncHandler(async (req, res) => {
      const input = validateUnitQuery(req.query);
      sendSuccess(res, await service.list(input, requirePrincipal(req)));
    }),
    get: asyncHandler(async (req, res) => {
      const input = validateUnitParams(req.params);
      sendSuccess(res, await service.get(input, requirePrincipal(req)));
    }),
    create: asyncHandler(async (req, res) => {
      const input = validateUnitCreate(req.body);
      sendSuccess(
        res,
        await service.create(input, requirePrincipal(req)),
        "Đã thêm đơn vị tính",
        201,
      );
    }),
    update: asyncHandler(async (req, res) => {
      const params = validateUnitParams(req.params);
      const input = validateUnitUpdate(req.body);
      sendSuccess(
        res,
        await service.update(params, input, requirePrincipal(req)),
        "Đã cập nhật đơn vị tính",
      );
    }),
  };
}
