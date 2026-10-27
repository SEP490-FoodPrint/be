import { Router } from "express"
import MenuReviewRecordController from "./menu-review-record.controller.js"
import { validateCreate, validateUpdate } from "./menu-review-record.validation.js"
import { checkExists } from "./menu-review-record.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// Tất cả endpoints đều yêu cầu xác thực Bearer token
router.use(authenticate)

// 1. Tạo mới bản ghi
router.post("/", validateCreate, MenuReviewRecordController.create)

// 2. Lấy danh sách (kèm phân trang, lọc)
router.get("/", MenuReviewRecordController.getAll)

// 3. Lấy chi tiết theo ID
router.get("/:id", checkExists, MenuReviewRecordController.getById)

// 4. Cập nhật bản ghi theo ID
router.put("/:id", checkExists, validateUpdate, MenuReviewRecordController.update)

// 5. Xóa bản ghi theo ID
router.delete("/:id", checkExists, MenuReviewRecordController.remove)

export default router
