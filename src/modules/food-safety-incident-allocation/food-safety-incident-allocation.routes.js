import { Router } from "express"
import FoodSafetyIncidentAllocationController from "./food-safety-incident-allocation.controller.js"
import { validateCreate, validateUpdate } from "./food-safety-incident-allocation.validation.js"
import { checkExists } from "./food-safety-incident-allocation.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, FoodSafetyIncidentAllocationController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", FoodSafetyIncidentAllocationController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:incident_id/:meal_allocation_id", checkExists, FoodSafetyIncidentAllocationController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:incident_id/:meal_allocation_id", checkExists, validateUpdate, FoodSafetyIncidentAllocationController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:incident_id/:meal_allocation_id", checkExists, FoodSafetyIncidentAllocationController.remove)

export default router
