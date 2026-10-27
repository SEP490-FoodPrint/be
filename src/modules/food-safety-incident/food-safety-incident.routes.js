import { Router } from "express"
import FoodSafetyIncidentController from "./food-safety-incident.controller.js"
import { validateCreate, validateUpdate } from "./food-safety-incident.validation.js"
import { checkExists } from "./food-safety-incident.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, FoodSafetyIncidentController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", FoodSafetyIncidentController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, FoodSafetyIncidentController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, FoodSafetyIncidentController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, FoodSafetyIncidentController.remove)

export default router
