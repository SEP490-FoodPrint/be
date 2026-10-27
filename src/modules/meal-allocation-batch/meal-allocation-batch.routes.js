import { Router } from "express"
import MealAllocationBatchController from "./meal-allocation-batch.controller.js"
import { validateCreate, validateUpdate } from "./meal-allocation-batch.validation.js"
import { checkExists } from "./meal-allocation-batch.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, MealAllocationBatchController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", MealAllocationBatchController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:meal_allocation_id/:cooking_batch_id", checkExists, MealAllocationBatchController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:meal_allocation_id/:cooking_batch_id", checkExists, validateUpdate, MealAllocationBatchController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:meal_allocation_id/:cooking_batch_id", checkExists, MealAllocationBatchController.remove)

export default router
