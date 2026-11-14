import { Router } from "express";
import { createBlockchainDistributionController } from "./blockchain-distribution.controller";

export function createBlockchainDistributionRouter() {
  const router = Router();
  const controller = createBlockchainDistributionController();

  router.get("/", controller.list);
  router.post("/anchor", controller.anchor);

  return router;
}
