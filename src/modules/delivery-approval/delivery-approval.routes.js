import { Router } from "express"
import DeliveryApprovalController from "./delivery-approval.controller.js"
import { validateCreate, validateUpdate } from "./delivery-approval.validation.js"
import { checkExists } from "./delivery-approval.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, DeliveryApprovalController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", DeliveryApprovalController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, DeliveryApprovalController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, DeliveryApprovalController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, DeliveryApprovalController.remove)

export default router
