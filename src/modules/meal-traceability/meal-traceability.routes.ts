import { Router } from "express";
import { mealTraceabilityController } from "./meal-traceability.controller";

export function createMealTraceabilityRouter(): Router {
  const router = Router();

  // Endpoint truy xuất công khai / người dùng (phụ huynh, thanh tra, quản lý trường)
  router.get("/", mealTraceabilityController.getMealTraceability);

  // Truy xuất chung theo khối (mọi lớp của khối trong ngày + bữa), công khai
  router.get("/grade", mealTraceabilityController.getGradeMealTraceability);

  // Danh sách lớp công khai để Guest chọn lớp truy xuất (không cần token)
  router.get(
    "/public/schools/:schoolCode/classes",
    mealTraceabilityController.listPublicSchoolClasses,
  );

  return router;
}
