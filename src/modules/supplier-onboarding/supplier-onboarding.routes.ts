import { Router, type RequestHandler } from "express";
import multer from "multer";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePrincipal } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { assertContractManager } from "./supplier-onboarding.service";
import { onboardingController as controller } from "./supplier-onboarding.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
});
const receiveFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error: unknown) => {
    if (error)
      next(
        new HttpError(
          error instanceof multer.MulterError &&
            error.code === "LIMIT_FILE_SIZE"
            ? 413
            : 400,
          "Chỉ tải một tệp PDF/PNG/JPEG tối đa 10 MB mỗi lần.",
        ),
      );
    else next();
  });
};
const manage: RequestHandler = (req, _res, next) => {
  try {
    assertContractManager(requirePrincipal(req));
    next();
  } catch (error) {
    next(error);
  }
};

export function createSupplierOnboardingRouter(
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  router.get("/supplier-directory", authHandler, controller.directory);
  router.get("/supplier-directory-filters", authHandler, controller.filters);
  router.get("/supplier-locations", authHandler, controller.locations);
  router.get("/supplier-directory/:supplierId", authHandler, controller.detail);
  router.get("/supplier-partnerships", authHandler, controller.partners);
  router.get("/supplier-contracts/:id", authHandler, controller.contract);
  router.post("/supplier-contracts", authHandler, manage, controller.create);
  router.put("/supplier-contracts/:id", authHandler, manage, controller.update);
  router.post(
    "/supplier-contracts/:id/documents",
    authHandler,
    manage,
    receiveFile,
    controller.upload,
  );
  router.get(
    "/supplier-contract-documents/:id",
    authHandler,
    controller.download,
  );
  router.delete(
    "/supplier-contract-documents/:id",
    authHandler,
    manage,
    controller.removeDocument,
  );
  router.post(
    "/supplier-contracts/:id/activate",
    authHandler,
    manage,
    controller.activate,
  );
  router.post(
    "/supplier-contracts/:id/close",
    authHandler,
    manage,
    controller.close,
  );
  router.post(
    "/supplier-partnerships/:id/:action",
    authHandler,
    manage,
    controller.transition,
  );
  router.post("/supply-requests", authHandler, controller.createOrder);
  router.post("/supply-requests/:id/send", authHandler, controller.sendOrder);
  router.get(
    "/supply-requests/:id/contract-evidence",
    authHandler,
    controller.orderEvidence,
  );
  return router;
}
