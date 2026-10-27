import { Router } from "express"
import MealAllocationController from "./meal-allocation.controller.js"
import { validateCreate, validateUpdate } from "./meal-allocation.validation.js"
import { checkExists } from "./meal-allocation.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, MealAllocationController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", MealAllocationController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, MealAllocationController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, MealAllocationController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, MealAllocationController.remove)

export default router
