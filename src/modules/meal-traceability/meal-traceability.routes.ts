import { Router } from "express";
import { mealTraceabilityController } from "./meal-traceability.controller";

export function createMealTraceabilityRouter(): Router {
  const router = Router();

  // Truy xuất chung theo khối (mọi lớp của khối trong ngày + bữa), công khai
  router.get("/grade", mealTraceabilityController.getGradeMealTraceability);

  return router;
}
