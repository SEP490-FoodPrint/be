import { Router } from "express"
import ClassController from "./class.controller.js"
import { validateCreate, validateUpdate } from "./class.validation.js"
import { checkExists } from "./class.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, ClassController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", ClassController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, ClassController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, ClassController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, ClassController.remove)

export default router
