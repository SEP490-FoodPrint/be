import { Router } from "express"
import TraceabilityAnchorController from "./traceability-anchor.controller.js"
import { validateCreate, validateUpdate } from "./traceability-anchor.validation.js"
import { checkExists } from "./traceability-anchor.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, TraceabilityAnchorController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", TraceabilityAnchorController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, TraceabilityAnchorController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, TraceabilityAnchorController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, TraceabilityAnchorController.remove)

export default router
