import { Router } from "express";

const router = Router();

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "FoodPrint Backend API",
    architecture: "Modular Architecture",
    database: "PostgreSQL (Prisma)",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Đăng ký routes của các modules tại đây khi triển khai từng module:
 *
 * import authRoutes from "../modules/auth/auth.routes"
 * import userRoutes from "../modules/user/user.routes"
 * import menuRoutes from "../modules/menu/menu.routes"
 *
 * router.use("/auth", authRoutes)
 * router.use("/users", userRoutes)
 * router.use("/menus", menuRoutes)
 */

export default router;
