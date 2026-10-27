import { Router } from "express"
import DeliveryItemController from "./delivery-item.controller.js"
import { validateCreate, validateUpdate } from "./delivery-item.validation.js"
import { checkExists } from "./delivery-item.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, DeliveryItemController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", DeliveryItemController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, DeliveryItemController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, DeliveryItemController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, DeliveryItemController.remove)

export default router
