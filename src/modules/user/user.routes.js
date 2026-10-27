import { Router } from "express"
import UserController from "./user.controller.js"
import { validateCreate, validateUpdate } from "./user.validation.js"
import { checkExists } from "./user.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, UserController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", UserController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, UserController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, UserController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, UserController.remove)

export default router
