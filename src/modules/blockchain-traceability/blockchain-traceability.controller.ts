import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess, sendError } from "../../utils/response";
import {
  traceParamsSchema,
  verifyParamsSchema,
  searchTraceQuerySchema,
} from "./blockchain-traceability.validation";
import {
  traceFromAllocation,
  verifyAnchor,
  searchTraceableAllocations,
} from "./blockchain-traceability.service";

interface VerifyBody {
  testModifiedPayload?: string;
}

export function createBlockchainTraceabilityController() {
  return {
    search: asyncHandler(async (req, res) => {
      const parsed = searchTraceQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(
          res,
          "Tham số tìm kiếm không hợp lệ.",
          400,
          parsed.error.issues,
        );
        return;
      }
      const data = await searchTraceableAllocations(
        parsed.data.keyword,
        parsed.data.date,
        parsed.data.limit,
      );
      sendSuccess(res, data, "Lấy danh sách phân bổ truy xuất thành công.");
    }),

    trace: asyncHandler(async (req, res) => {
      const parsed = traceParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        sendError(
          res,
          "Mã phân bổ suất ăn không hợp lệ.",
          400,
          parsed.error.issues,
        );
        return;
      }
      try {
        const data = await traceFromAllocation(parsed.data.mealAllocationId);
        sendSuccess(res, data, "Truy vết chuỗi cung ứng suất ăn thành công.");
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Lỗi truy vết chuỗi cung ứng.";
        sendError(res, message, 404);
      }
    }),

    verify: asyncHandler(async (req, res) => {
      const parsedParams = verifyParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        sendError(
          res,
          "Mã mốc truy xuất (anchorId) không hợp lệ.",
          400,
          parsedParams.error.issues,
        );
        return;
      }
      const body = req.body as VerifyBody;
      const testModifiedPayload =
        typeof body?.testModifiedPayload === "string"
          ? body.testModifiedPayload
          : undefined;
      try {
        const result = await verifyAnchor(
          parsedParams.data.anchorId,
          testModifiedPayload,
        );
        sendSuccess(res, result, "Đối chiếu bằng chứng Blockchain thành công.");
      } catch (error: unknown) {
        console.error(
          "[BlockchainTraceabilityController] Verify Error:",
          error,
        );
        const message =
          error instanceof Error
            ? error.message
            : "Lỗi khi đối chiếu bằng chứng Blockchain.";
        sendError(res, message, 500);
      }
    }),
  };
}
