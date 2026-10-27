import { Router } from "express"
import FoodSafetyReportForwardingController from "./food-safety-report-forwarding.controller.js"
import { validateCreate, validateUpdate } from "./food-safety-report-forwarding.validation.js"
import { checkExists } from "./food-safety-report-forwarding.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, FoodSafetyReportForwardingController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", FoodSafetyReportForwardingController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, FoodSafetyReportForwardingController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, FoodSafetyReportForwardingController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, FoodSafetyReportForwardingController.remove)

export default router
