import { Router } from "express"
import WeeklyMenuController from "./weekly-menu.controller.js"
import { validateCreate, validateUpdate } from "./weekly-menu.validation.js"
import { checkExists } from "./weekly-menu.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, WeeklyMenuController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", WeeklyMenuController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, WeeklyMenuController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, WeeklyMenuController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, WeeklyMenuController.remove)

export default router
