import { Router } from "express"
import DishIngredientEntryController from "./dish-ingredient-entry.controller.js"
import { validateCreate, validateUpdate } from "./dish-ingredient-entry.validation.js"
import { checkExists } from "./dish-ingredient-entry.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, DishIngredientEntryController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", DishIngredientEntryController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:dish_id/:ingredient_entry_id", checkExists, DishIngredientEntryController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:dish_id/:ingredient_entry_id", checkExists, validateUpdate, DishIngredientEntryController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:dish_id/:ingredient_entry_id", checkExists, DishIngredientEntryController.remove)

export default router
