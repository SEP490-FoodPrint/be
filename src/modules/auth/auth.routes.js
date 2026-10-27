import { Router } from "express"
import AuthController from "./auth.controller.js"
import { validateLogin, validateChangePassword, validateCreate, validateUpdate } from "./auth.validation.js"
import { checkExists } from "./auth.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

// 1. API Đăng nhập công khai
router.post("/login", validateLogin, AuthController.login)

// 2. API Xem profile hiện tại
router.get("/me", authenticate, AuthController.getProfile)

// 3. API Đổi mật khẩu
router.put("/change-password", authenticate, validateChangePassword, AuthController.changePassword)

// 4. API Đăng xuất
router.post("/logout", authenticate, AuthController.logout)

// 5. Chuẩn 5 API CRUD phiên xác thực
router.post("/", authenticate, validateCreate, AuthController.create)
router.get("/", authenticate, AuthController.getAll)
router.get("/:id", authenticate, checkExists, AuthController.getById)
router.put("/:id", authenticate, checkExists, validateUpdate, AuthController.update)
router.delete("/:id", authenticate, checkExists, AuthController.remove)

export default router
