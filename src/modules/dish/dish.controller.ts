import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { dishService, type DishService } from "./dish.service";
import { validateDishListQuery } from "./dish.validation";

export function createDishController(service: DishService = dishService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateDishListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách món ăn thành công");
    }),
  };
}
