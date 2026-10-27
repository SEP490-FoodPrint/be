import { Router } from "express"
import MealComplaintController from "./meal-complaint.controller.js"
import { validateCreate, validateUpdate } from "./meal-complaint.validation.js"
import { checkExists } from "./meal-complaint.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, MealComplaintController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", MealComplaintController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, MealComplaintController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, MealComplaintController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, MealComplaintController.remove)

export default router
