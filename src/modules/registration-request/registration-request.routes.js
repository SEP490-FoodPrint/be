import { Router } from "express"
import RegistrationRequestController from "./registration-request.controller.js"
import { validateCreate, validateUpdate } from "./registration-request.validation.js"
import { checkExists } from "./registration-request.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, RegistrationRequestController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", RegistrationRequestController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, RegistrationRequestController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, RegistrationRequestController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, RegistrationRequestController.remove)

export default router
