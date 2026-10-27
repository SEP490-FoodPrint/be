import { Router } from "express"
import CookingBatchLotController from "./cooking-batch-lot.controller.js"
import { validateCreate, validateUpdate } from "./cooking-batch-lot.validation.js"
import { checkExists } from "./cooking-batch-lot.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, CookingBatchLotController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", CookingBatchLotController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:cooking_batch_id/:ingredient_lot_id", checkExists, CookingBatchLotController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:cooking_batch_id/:ingredient_lot_id", checkExists, validateUpdate, CookingBatchLotController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:cooking_batch_id/:ingredient_lot_id", checkExists, CookingBatchLotController.remove)

export default router
