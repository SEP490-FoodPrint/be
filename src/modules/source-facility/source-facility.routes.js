import { Router } from "express"
import SourceFacilityController from "./source-facility.controller.js"
import { validateCreate, validateUpdate } from "./source-facility.validation.js"
import { checkExists } from "./source-facility.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, SourceFacilityController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", SourceFacilityController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, SourceFacilityController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, SourceFacilityController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, SourceFacilityController.remove)

export default router
