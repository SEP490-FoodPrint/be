import { Router } from "express"
import SupplierCertificationController from "./supplier-certification.controller.js"
import { validateCreate, validateUpdate } from "./supplier-certification.validation.js"
import { checkExists } from "./supplier-certification.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, SupplierCertificationController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", SupplierCertificationController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, SupplierCertificationController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, SupplierCertificationController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, SupplierCertificationController.remove)

export default router
