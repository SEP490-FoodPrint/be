import { Router } from "express"
import InventoryTransactionController from "./inventory-transaction.controller.js"
import { validateCreate, validateUpdate } from "./inventory-transaction.validation.js"
import { checkExists } from "./inventory-transaction.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, InventoryTransactionController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", InventoryTransactionController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, InventoryTransactionController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, InventoryTransactionController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, InventoryTransactionController.remove)

export default router
