import { Router } from "express"
import DishController from "./dish.controller.js"
import { validateCreate, validateUpdate } from "./dish.validation.js"
import { checkExists } from "./dish.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, DishController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", DishController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, DishController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, DishController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, DishController.remove)

export default router
