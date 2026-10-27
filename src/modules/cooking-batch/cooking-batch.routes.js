import { Router } from "express"
import CookingBatchController from "./cooking-batch.controller.js"
import { validateCreate, validateUpdate } from "./cooking-batch.validation.js"
import { checkExists } from "./cooking-batch.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, CookingBatchController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", CookingBatchController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, CookingBatchController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, CookingBatchController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, CookingBatchController.remove)

export default router
