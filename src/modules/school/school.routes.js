import { Router } from "express"
import SchoolController from "./school.controller.js"
import { validateCreate, validateUpdate } from "./school.validation.js"
import { checkExists } from "./school.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, SchoolController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", SchoolController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, SchoolController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, SchoolController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, SchoolController.remove)

export default router
