import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { createBlockchainProofController } from "./blockchain-proof.controller";
import {
  blockchainProofService,
  type BlockchainProofService,
} from "./blockchain-proof.service";

export function createBlockchainProofRouter(
  service: BlockchainProofService = blockchainProofService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createBlockchainProofController(service);
  router.get(
    "/:kind/:recordId/versions",
    authHandler,
    requirePermission("traceability.view"),
    controller.listVersions,
  );
  router.post(
    "/:kind/versions/:versionId/anchor",
    authHandler,
    requirePermission("traceability.verify"),
    controller.anchor,
  );
  router.post(
    "/:kind/versions/:versionId/verify",
    authHandler,
    requirePermission("traceability.verify"),
    controller.verify,
  );
  return router;
}

export default createBlockchainProofRouter();
