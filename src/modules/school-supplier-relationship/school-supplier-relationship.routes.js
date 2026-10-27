import { Router } from "express"
import SchoolSupplierRelationshipController from "./school-supplier-relationship.controller.js"
import { validateCreate, validateUpdate } from "./school-supplier-relationship.validation.js"
import { checkExists } from "./school-supplier-relationship.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, SchoolSupplierRelationshipController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", SchoolSupplierRelationshipController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, SchoolSupplierRelationshipController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, SchoolSupplierRelationshipController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, SchoolSupplierRelationshipController.remove)

export default router
