import type { RequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../utils/http-error";
import { MAX_DOCUMENT_BYTES } from "../utils/onboarding-documents";
import { MAX_CERTIFICATIONS } from "../modules/auth/onboarding.validation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: MAX_CERTIFICATIONS,
    fields: 1,
    fieldSize: 32768,
    parts: MAX_CERTIFICATIONS + 1,
  },
  fileFilter: (_req, file, done) => {
    if (["application/pdf", "image/png", "image/jpeg"].includes(file.mimetype))
      done(null, true);
    else done(new HttpError(400, "Chỉ nhận PDF, PNG hoặc JPEG"));
  },
}).any();
export const onboardingUpload: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) return next();
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(
        new HttpError(
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
          "Tệp hoặc multipart vượt giới hạn hồ sơ",
        ),
      );
    } else next(error);
  });
};
