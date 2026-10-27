import { Router } from "express"
import IngredientEntryController from "./ingredient-entry.controller.js"
import { validateCreate, validateUpdate } from "./ingredient-entry.validation.js"
import { checkExists } from "./ingredient-entry.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, IngredientEntryController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", IngredientEntryController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, IngredientEntryController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, IngredientEntryController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, IngredientEntryController.remove)

export default router
