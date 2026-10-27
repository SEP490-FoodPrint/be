import { Router } from "express"
import MenuDayDishController from "./menu-day-dish.controller.js"
import { validateCreate, validateUpdate } from "./menu-day-dish.validation.js"
import { checkExists } from "./menu-day-dish.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, MenuDayDishController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", MenuDayDishController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:menu_day_id/:dish_id/:meal_type", checkExists, MenuDayDishController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:menu_day_id/:dish_id/:meal_type", checkExists, validateUpdate, MenuDayDishController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:menu_day_id/:dish_id/:meal_type", checkExists, MenuDayDishController.remove)

export default router
