import { Router } from "express"
import SupplierController from "./supplier.controller.js"
import { validateCreate, validateUpdate } from "./supplier.validation.js"
import { checkExists } from "./supplier.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, SupplierController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", SupplierController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, SupplierController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, SupplierController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, SupplierController.remove)

export default router
