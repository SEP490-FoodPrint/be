import { createSessionController } from "./session.controller";
import { Router } from "express";
import type { RequestHandler } from "express";
import {
  authenticate,
  createSessionAuthenticate,
} from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createAuthController } from "./auth.controller";
import { authService, type AuthService } from "./auth.service";
import { type SessionService, sessionService } from "./session.service";
import { type SignupService, signupService } from "./signup.service";
import { createOnboardingController } from "./onboarding.controller";
import type { OnboardingService } from "./onboarding.service";
import { onboardingUpload } from "../../middlewares/onboarding-upload.middleware";
import { createEmailVerificationController } from "./email-verification.controller";
import type { EmailVerificationService } from "./email-verification.service";
import { createProfileController } from "./profile.controller";
import type { ProfileService } from "./profile.service";

export interface AuthServices {
  session: SessionService;
  signup: SignupService;
  sessionAuthenticate?: RequestHandler;
  onboarding?: OnboardingService;
  emailVerification?: EmailVerificationService;
  profile?: ProfileService;
}

export function createAuthRouter(
  service: AuthService = authService,
  authHandler: RequestHandler = authenticate,
  services: AuthServices = { session: sessionService, signup: signupService },
) {
  const router = Router();
  const controller = createAuthController(service);
  router.get("/roles", authHandler, requireResource("auth"), controller.getAll);
  const session = createSessionController(services.session, services.signup);
  const sessionAuth =
    services.sessionAuthenticate ??
    createSessionAuthenticate((id) => services.session.currentUser(id));
  router.post("/login", session.login);
  router.post("/signup", session.signup);
  router.post("/refresh", session.refresh);
  router.post("/logout", session.logout);
  const emailVerification = createEmailVerificationController(
    services.emailVerification,
  );
  router.post("/email-verification/request", emailVerification.request);
  router.post("/email-verification/verify", emailVerification.verify);
  router.get("/me", sessionAuth, session.me);
  router.patch(
    "/me",
    sessionAuth,
    createProfileController(services.profile).update,
  );
  router.get("/me/permissions", sessionAuth, session.permissions);
  const onboarding = createOnboardingController(services.onboarding);
  router.get("/onboarding", sessionAuth, onboarding.own);
  router.post("/onboarding", sessionAuth, onboardingUpload, onboarding.submit);
  router.get(
    "/onboarding/documents/:documentId",
    sessionAuth,
    onboarding.ownDocument,
  );
  return router;
}

export default createAuthRouter();
