import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { kitchenService, type KitchenService } from "./kitchen.service";
import {
  validateKitchenAction,
  validateKitchenListQuery,
  validateKitchenPlan,
} from "./kitchen.validation";
import { uuid } from "../../utils/auth-validation";
import { kitchenLifecycle, type KitchenLifecycle } from "./kitchen.lifecycle";

export function createKitchenController(
  service: KitchenService = kitchenService,
  lifecycle: KitchenLifecycle = kitchenLifecycle,
) {
  return {
    getOne: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await lifecycle.getOne(uuid(req.params.id), requirePrincipal(req)),
      );
    }),
    plan: asyncHandler(async (req, res) => {
      const input = validateKitchenPlan(req.body as unknown);
      const result = await lifecycle.plan(input, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Đã lập phương án chế biến",
        result.created ? 201 : 200,
      );
    }),
    confirm: asyncHandler(async (req, res) => {
      validateKitchenAction(req.body as unknown);
      sendSuccess(
        res,
        await lifecycle.confirm(uuid(req.params.id), requirePrincipal(req)),
        "Đã xác nhận kế hoạch",
      );
    }),
    complete: asyncHandler(async (req, res) => {
      validateKitchenAction(req.body as unknown);
      sendSuccess(
        res,
        await lifecycle.complete(uuid(req.params.id), requirePrincipal(req)),
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
