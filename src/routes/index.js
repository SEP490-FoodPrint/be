import { Router } from "express"
import menuRoutes from "../modules/menu/menu.routes.js"

const router = Router()

router.use("/menus", menuRoutes)

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "FoodPrint Backend API",
    architecture: "Modular Architecture",
    database: "PostgreSQL (foodprint)",
    timestamp: new Date().toISOString(),
  })
})

/**
 * Đăng ký routes của các modules tại đây khi triển khai từng module:
 *
 * import authRoutes from "../modules/auth/auth.routes.js"
 * import userRoutes from "../modules/user/user.routes.js"
 * import menuRoutes from "../modules/menu/menu.routes.js"
 *
 * router.use("/auth", authRoutes)
 * router.use("/users", userRoutes)
 * router.use("/menus", menuRoutes)
 */

export default router
