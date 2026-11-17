import { Router } from "express";
import { mealTraceabilityController } from "./meal-traceability.controller";

export function createMealTraceabilityRouter(): Router {
  const router = Router();

  // Endpoint truy xuất công khai / người dùng (phụ huynh, thanh tra, quản lý trường)
  router.get("/", mealTraceabilityController.getMealTraceability);

  return router;
}
