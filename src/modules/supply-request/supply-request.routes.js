import { Router } from "express"
import SupplyRequestController from "./supply-request.controller.js"
import { validateCreate, validateUpdate } from "./supply-request.validation.js"
import { checkExists } from "./supply-request.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, SupplyRequestController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", SupplyRequestController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, SupplyRequestController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, SupplyRequestController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, SupplyRequestController.remove)

export default router
