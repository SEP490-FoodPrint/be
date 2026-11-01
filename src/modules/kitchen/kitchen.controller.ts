import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { kitchenService, type KitchenService } from "./kitchen.service";
import {
  validateKitchenAction,
  validateKitchenListQuery,
  validateKitchenPlan,
  validateKitchenComplete,
  validateKitchenFilters,
  validateKitchenUpdate,
} from "./kitchen.validation";
import { uuid } from "../../utils/auth-validation";

export function createKitchenController(
  service: KitchenService = kitchenService,
) {
  return {
    update: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.update(
          uuid(req.params.id),
          validateKitchenUpdate(req.body),
          requirePrincipal(req),
        ),
        "Đã sửa ghi chú mẻ chưa xác nhận",
      );
    }),
    remove: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.remove(uuid(req.params.id), requirePrincipal(req)),
        "Đã xóa mẻ chưa xác nhận và giải phóng giữ chỗ",
      );
    }),
    list: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.list(
            validateKitchenFilters(req.query),
            requirePrincipal(req),
          ),
        ),
    ),
    stats: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.stats(
            validateKitchenFilters(req.query),
            requirePrincipal(req),
          ),
        ),
    ),
    inspectionSheet: asyncHandler(
      async (req, res) =>
        void sendSuccess(
          res,
          await service.inspectionSheet(
            uuid(req.params.id),
            requirePrincipal(req),
          ),
        ),
    ),
    getOne: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getOne(uuid(req.params.id), requirePrincipal(req)),
      );
    }),
    plan: asyncHandler(async (req, res) => {
      const input = validateKitchenPlan(req.body as unknown);
      const result = await service.plan(input, requirePrincipal(req));
      sendSuccess(
        res,
        {
          ...(result.batches.length === 1 ? result.batches[0] : {}),
          ...result,
          batchCount: result.batches.length,
        },
        "Đã lập phương án chế biến",
        result.created ? 201 : 200,
      );
    }),
    confirm: asyncHandler(async (req, res) => {
      validateKitchenAction(req.body as unknown);
      sendSuccess(
        res,
        await service.confirm(uuid(req.params.id), requirePrincipal(req)),
        "Đã xác nhận kế hoạch",
      );
    }),
    complete: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.complete(
          uuid(req.params.id),
          requirePrincipal(req),
          validateKitchenComplete(req.body),
        ),
        "Đã xác nhận hoàn thành theo kế hoạch",
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateKitchenListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách mẻ nấu thành công");
    }),
  };
}
