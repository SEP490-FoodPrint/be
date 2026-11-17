import { Router } from "express";
import type { RequestHandler } from "express";
import { assertPermission, requirePrincipal } from "../../utils/authorization";
import { authenticate } from "../../middlewares/auth.middleware";
import { createBlockchainProofController } from "./blockchain-proof.controller";
import {
  blockchainProofService,
  type BlockchainProofService,
} from "./blockchain-proof.service";

/**
 * Coarse gate by kind; the service enforces role, organization and scope.
 * Registration proofs are reviewed by System Admin, and suppliers may open the
 * declarations of their own deliveries.
 */
function proofPermission(
  traceability: string,
  registration: string,
): RequestHandler {
  return (req, _res, next) => {
    try {
      const kind = req.params.kind;
      const codes =
        kind === "registrations"
          ? [registration]
          : kind === "delivery-declarations"
            ? [traceability, "delivery.manage"]
            : [traceability];
      assertPermission(requirePrincipal(req), ...codes);
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requireChainPermission: RequestHandler = (req, _res, next) => {
  try {
    assertPermission(requirePrincipal(req), "traceability.view");
    next();
  } catch (error) {
    next(error);
  }
};

export function createBlockchainProofRouter(
  service: BlockchainProofService = blockchainProofService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createBlockchainProofController(service);
  // Public journey of a school's meals by grade: no login, operational details removed.
  router.get(
    "/public/schools/:schoolCode/grade-meals",
    controller.publicGradeMeals,
  );
  router.get(
    "/public/schools/:schoolCode/grade-meals/:gradeId",
    controller.publicGradeChain,
  );
  router.get(
    "/chains/grade-meals",
    authHandler,
    requireChainPermission,
    controller.gradeMeals,
  );
  router.get(
    "/chains/grade-meals/:gradeId",
    authHandler,
    requireChainPermission,
    controller.gradeChain,
  );
  router.get(
    "/chains/meal-allocations/:mealAllocationId",
    authHandler,
    requireChainPermission,
    controller.chain,
  );
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
