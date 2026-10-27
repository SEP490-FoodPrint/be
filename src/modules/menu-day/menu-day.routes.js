import { Router } from "express"
import MenuDayController from "./menu-day.controller.js"
import { validateCreate, validateUpdate } from "./menu-day.validation.js"
import { checkExists } from "./menu-day.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, MenuDayController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", MenuDayController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, MenuDayController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, MenuDayController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, MenuDayController.remove)

export default router
