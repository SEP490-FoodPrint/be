import { Router } from "express"
import SupplyRequestItemController from "./supply-request-item.controller.js"
import { validateCreate, validateUpdate } from "./supply-request-item.validation.js"
import { checkExists } from "./supply-request-item.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, SupplyRequestItemController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", SupplyRequestItemController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, SupplyRequestItemController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, SupplyRequestItemController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, SupplyRequestItemController.remove)

export default router
