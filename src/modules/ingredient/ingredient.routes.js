import { Router } from "express"
import IngredientController from "./ingredient.controller.js"
import { validateCreate, validateUpdate } from "./ingredient.validation.js"
import { checkExists } from "./ingredient.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, IngredientController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", IngredientController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, IngredientController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, IngredientController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, IngredientController.remove)

export default router
