import { Router } from "express"
import CommuneFoodSafetyUnitController from "./commune-food-safety-unit.controller.js"
import { validateCreate, validateUpdate } from "./commune-food-safety-unit.validation.js"
import { checkExists } from "./commune-food-safety-unit.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, CommuneFoodSafetyUnitController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", CommuneFoodSafetyUnitController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, CommuneFoodSafetyUnitController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, CommuneFoodSafetyUnitController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, CommuneFoodSafetyUnitController.remove)

export default router
