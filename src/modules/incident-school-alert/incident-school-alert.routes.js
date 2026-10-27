import { Router } from "express"
import IncidentSchoolAlertController from "./incident-school-alert.controller.js"
import { validateCreate, validateUpdate } from "./incident-school-alert.validation.js"
import { checkExists } from "./incident-school-alert.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, IncidentSchoolAlertController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", IncidentSchoolAlertController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, IncidentSchoolAlertController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, IncidentSchoolAlertController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, IncidentSchoolAlertController.remove)

export default router
