import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { supplyRoundService } from "./supply-round.service";
import {
  roundApprovalSchema,
  roundDishParamsSchema,
  roundQuerySchema,
  validateRoundInput,
} from "./supply-round.validation";

export const supplyRoundController = {
  get: asyncHandler(async (req, res) => {
    const result = await supplyRoundService.get(
      validateRoundInput(roundQuerySchema, req.query),
      req.auth!,
    );
    sendSuccess(res, result, "Đã tải kế hoạch theo đợt giao");
  }),
  retry: asyncHandler(async (req, res) => {
    const result = await supplyRoundService.retry(
      validateRoundInput(roundDishParamsSchema, req.params),
      req.auth!,
    );
    sendSuccess(res, result, "Đã kiểm tra lại kế hoạch của món");
  }),
  approve: asyncHandler(async (req, res) => {
    const result = await supplyRoundService.approve(
      validateRoundInput(roundDishParamsSchema, req.params),
      validateRoundInput(roundApprovalSchema, req.body),
      req.auth!,
    );
    sendSuccess(res, result, "Đã duyệt kế hoạch của món");
  }),
};
