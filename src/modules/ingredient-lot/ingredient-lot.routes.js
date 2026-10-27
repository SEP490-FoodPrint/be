import { Router } from "express"
import IngredientLotController from "./ingredient-lot.controller.js"
import { validateCreate, validateUpdate } from "./ingredient-lot.validation.js"
import { checkExists } from "./ingredient-lot.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, IngredientLotController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", IngredientLotController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, IngredientLotController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, IngredientLotController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, IngredientLotController.remove)

export default router
