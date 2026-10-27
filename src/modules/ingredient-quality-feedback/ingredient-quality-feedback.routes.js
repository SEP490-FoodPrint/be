import { Router } from "express"
import IngredientQualityFeedbackController from "./ingredient-quality-feedback.controller.js"
import { validateCreate, validateUpdate } from "./ingredient-quality-feedback.validation.js"
import { checkExists } from "./ingredient-quality-feedback.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, IngredientQualityFeedbackController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", IngredientQualityFeedbackController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, IngredientQualityFeedbackController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, IngredientQualityFeedbackController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, IngredientQualityFeedbackController.remove)

export default router
