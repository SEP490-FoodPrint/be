import { Router } from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createRegistrationController } from "./registration.controller";
import {
  registrationService,
  type RegistrationService,
} from "./registration.service";
import { createOnboardingController } from "../auth/onboarding.controller";
import type { OnboardingService } from "../auth/onboarding.service";
import { sendError } from "../../utils/response";
import { RegistrationValidationError } from "./registration.validation";

const registrationValidationErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (!(error instanceof RegistrationValidationError)) return next(error);
  return sendError(res, error.message, error.statusCode, {
    fields: error.fields,
  });
};

export function createRegistrationRouter(
  service: RegistrationService = registrationService,
  authHandler: RequestHandler = authenticate,
  onboardingService?: OnboardingService,
) {
  const router = Router();
  const controller = createRegistrationController(service);
  router.get(
    "/",
    authHandler,
    requireResource("registration"),
    controller.getAll,
  );
  const onboarding = createOnboardingController(onboardingService);
  router.get("/:id", authHandler, onboarding.detail);
  router.get(
    "/:id/documents/:documentId",
    authHandler,
    onboarding.reviewDocument,
  );
  router.post("/:id/approve", authHandler, onboarding.approve);
  router.post("/:id/reject", authHandler, onboarding.reject);
  router.use(registrationValidationErrorHandler);
  return router;
}

export default createRegistrationRouter();
