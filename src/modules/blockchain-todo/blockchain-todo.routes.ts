import { Router } from "express";
import { isError } from "ethers";
import { asyncHandler } from "../../utils/async-handler";
import { sendError, sendSuccess } from "../../utils/response";
import { executeTodo } from "./blockchain-todo.service";
import { operation } from "./blockchain-todo.validation";

export function createBlockchainTodoRouter() {
  const router = Router();
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = operation.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, "Dữ liệu todo không hợp lệ.", 400);
        return;
      }
      try {
        const data = await executeTodo(parsed.data);
        sendSuccess(
          res,
          data,
          "Thành công",
          parsed.data.action === "create" ? 201 : 200,
        );
      } catch (error) {
        if (
          isError(error, "CALL_EXCEPTION") &&
          error.revert?.name === "RecordNotFound"
        ) {
          sendError(res, "Todo không còn trên node hiện tại.", 404);
          return;
        }
        console.error(error);
        sendError(
          res,
          "Không gọi được contract. Kiểm tra Hardhat node và chạy deploy:local.",
          503,
        );
      }
    }),
  );
  return router;
}
