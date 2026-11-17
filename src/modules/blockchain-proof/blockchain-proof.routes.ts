import { Router } from "express";
import type { RequestHandler } from "express";
import { assertPermission, requirePrincipal } from "../../utils/authorization";
import { authenticate } from "../../middlewares/auth.middleware";
import { createBlockchainProofController } from "./blockchain-proof.controller";
import {
  blockchainProofService,
  type BlockchainProofService,
} from "./blockchain-proof.service";

/** Registration proofs are reviewed by System Admin, not by school traceability roles. */
function proofPermission(
  traceability: string,
  registration: string,
): RequestHandler {
  return (req, _res, next) => {
    try {
      assertPermission(
        requirePrincipal(req),
        req.params.kind === "registrations" ? registration : traceability,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createBlockchainProofRouter(
  service: BlockchainProofService = blockchainProofService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createBlockchainProofController(service);
  router.get(
    "/:kind/:recordId/versions",
    authHandler,
    proofPermission("traceability.view", "registration.view"),
    controller.listVersions,
  );
  router.post(
    "/:kind/versions/:versionId/anchor",
    authHandler,
    proofPermission("traceability.verify", "registration.approve"),
    controller.anchor,
  );
  router.post(
    "/:kind/versions/:versionId/verify",
    authHandler,
    proofPermission("traceability.verify", "registration.view"),
    controller.verify,
  );
  return router;
}

export default createBlockchainProofRouter();
