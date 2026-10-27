import { Router } from "express"
import ClassAllergyController from "./class-allergy.controller.js"
import { validateCreate, validateUpdate } from "./class-allergy.validation.js"
import { checkExists } from "./class-allergy.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, ClassAllergyController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", ClassAllergyController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:class_id/:ingredient_entry_id", checkExists, ClassAllergyController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:class_id/:ingredient_entry_id", checkExists, validateUpdate, ClassAllergyController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:class_id/:ingredient_entry_id", checkExists, ClassAllergyController.remove)

export default router
