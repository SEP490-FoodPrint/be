import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess, sendError } from "../../utils/response";
import {
  anchorManualSchema,
  listAnchorsQuerySchema,
} from "./blockchain-distribution.validation";
import {
  anchorManual,
  getDistributionAnchors,
} from "./blockchain-distribution.service";

interface UserContext {
  user?: { id?: string };
}

export function createBlockchainDistributionController() {
  return {
    list: asyncHandler(async (req, res) => {
      const parsed = listAnchorsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(
          res,
          "Tham số truy vấn không hợp lệ.",
          400,
          parsed.error.issues,
        );
        return;
      }
      const data = await getDistributionAnchors(parsed.data);
      sendSuccess(res, data, "Lấy danh sách bằng chứng phân bổ thành công.");
    }),

    anchor: asyncHandler(async (req, res) => {
      const parsed = anchorManualSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          "Dữ liệu yêu cầu không hợp lệ.",
          400,
          parsed.error.issues,
        );
        return;
      }
      try {
        const actorId = (req as unknown as UserContext).user?.id;
        const result = await anchorManual(parsed.data, actorId);
        sendSuccess(
          res,
          result,
          "Ghi nhận bằng chứng phân bổ lên Blockchain thành công.",
          201,
        );
      } catch (error: unknown) {
        console.error("[BlockchainDistributionController] Error:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Lỗi khi ghi nhận bằng chứng lên Blockchain.";
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? Number(error.status) || 500
            : 500;
        sendError(res, message, status);
      }
    }),
  };
}
