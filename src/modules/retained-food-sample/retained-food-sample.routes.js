import { Router } from "express"
import RetainedFoodSampleController from "./retained-food-sample.controller.js"
import { validateCreate, validateUpdate } from "./retained-food-sample.validation.js"
import { checkExists } from "./retained-food-sample.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, RetainedFoodSampleController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", RetainedFoodSampleController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, RetainedFoodSampleController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, RetainedFoodSampleController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, RetainedFoodSampleController.remove)

export default router
