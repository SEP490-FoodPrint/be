import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  mealAllocationService,
  type MealAllocationService,
} from "./meal-allocation.service";
import {
  validateMealAllocationListQuery,
  validateMealAllocationCreate,
} from "./meal-allocation.validation";
import { uuid, objectBody } from "../../utils/auth-validation";

export function createMealAllocationController(
  service: MealAllocationService = mealAllocationService,
) {
  return {
    getOne: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getOne(uuid(req.params.id), requirePrincipal(req)),
      );
    }),
    create: asyncHandler(async (req, res) => {
      const result = await service.create(
        validateMealAllocationCreate(req.body),
        requirePrincipal(req),
      );
      sendSuccess(
        res,
        result,
        "Đã phân bổ các món theo nhóm suất đã chốt",
        result.created ? 201 : 200,
      );
    }),
    distribute: asyncHandler(async (req, res) => {
      objectBody(req.body ?? {}, []);
      sendSuccess(
        res,
        await service.distribute(uuid(req.params.id), requirePrincipal(req)),
        "Đã ghi nhận phân phối suất ăn",
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateMealAllocationListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách phân bổ suất ăn thành công");
    }),
  };
}
