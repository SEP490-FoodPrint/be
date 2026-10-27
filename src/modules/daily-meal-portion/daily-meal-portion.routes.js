import { Router } from "express"
import DailyMealPortionController from "./daily-meal-portion.controller.js"
import { validateCreate, validateUpdate } from "./daily-meal-portion.validation.js"
import { checkExists } from "./daily-meal-portion.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, DailyMealPortionController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", DailyMealPortionController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, DailyMealPortionController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, DailyMealPortionController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, DailyMealPortionController.remove)

export default router
