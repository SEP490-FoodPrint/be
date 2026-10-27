import { Router } from "express"
import RoleController from "./role.controller.js"
import { validateCreate, validateUpdate } from "./role.validation.js"
import { checkExists } from "./role.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, RoleController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", RoleController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, RoleController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, RoleController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, RoleController.remove)

export default router
