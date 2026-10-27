import { Router } from "express"
import DeliveryController from "./delivery.controller.js"
import { validateCreate, validateUpdate } from "./delivery.validation.js"
import { checkExists } from "./delivery.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, DeliveryController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", DeliveryController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, DeliveryController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, DeliveryController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, DeliveryController.remove)

export default router
