import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { createAccountLifecycleController } from "./account-lifecycle.controller";
import {
  accountLifecycleService,
  type AccountLifecycleService,
} from "./account-lifecycle.service";

export function createAccountLifecycleRouter(
  service: AccountLifecycleService = accountLifecycleService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAccountLifecycleController(service);
  router.get("/:userId/lifecycle", authHandler, controller.getLifecycle);
  router.post("/:userId/deactivate", authHandler, controller.deactivate);
  router.patch("/:userId/intake-state", authHandler, controller.setIntakeState);
  return router;
}
