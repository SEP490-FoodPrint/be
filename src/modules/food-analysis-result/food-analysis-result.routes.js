import { Router } from "express"
import FoodAnalysisResultController from "./food-analysis-result.controller.js"
import { validateCreate, validateUpdate } from "./food-analysis-result.validation.js"
import { checkExists } from "./food-analysis-result.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, FoodAnalysisResultController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", FoodAnalysisResultController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, FoodAnalysisResultController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, FoodAnalysisResultController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, FoodAnalysisResultController.remove)

export default router
