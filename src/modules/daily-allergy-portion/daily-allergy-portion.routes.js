import { Router } from "express"
import DailyAllergyPortionController from "./daily-allergy-portion.controller.js"
import { validateCreate, validateUpdate } from "./daily-allergy-portion.validation.js"
import { checkExists } from "./daily-allergy-portion.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, DailyAllergyPortionController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", DailyAllergyPortionController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:daily_meal_portion_id/:class_id/:ingredient_entry_id", checkExists, DailyAllergyPortionController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:daily_meal_portion_id/:class_id/:ingredient_entry_id", checkExists, validateUpdate, DailyAllergyPortionController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:daily_meal_portion_id/:class_id/:ingredient_entry_id", checkExists, DailyAllergyPortionController.remove)

export default router
