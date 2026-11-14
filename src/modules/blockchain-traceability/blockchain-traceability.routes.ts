import { Router } from "express";
import { createBlockchainTraceabilityController } from "./blockchain-traceability.controller";

export function createBlockchainTraceabilityRouter() {
  const router = Router();
  const controller = createBlockchainTraceabilityController();

  router.get("/search", controller.search);
  router.get("/trace/:mealAllocationId", controller.trace);
  router.post("/verify/:anchorId", controller.verify);

  return router;
}
