import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import multer from "multer";
import {
  documentFormat,
  documentStorage,
  type OnboardingDocument,
} from "./onboarding-documents";
import { HttpError } from "./http-error";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 8, parts: 9 },
});
export const receivePhoto: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) return next();
  upload.single("photo")(req, res, (error: unknown) => {
    if (error)
      return next(
        new HttpError(400, "Chỉ nhận một ảnh JPG hoặc PNG tối đa 5 MB."),
      );
    next();
  });
};
export type RecordPhoto = { photoPublicId: string; photoHash: string };
export async function uploadRecordPhoto(
  userId: string,
  file?: Express.Multer.File,
) {
  if (!file) return null;
  if (documentFormat(file) === "pdf")
    throw new HttpError(400, "Chỉ nhận ảnh JPG hoặc PNG.");
  const document = await documentStorage.upload(userId, file);
  return {
    document,
    photo: {
      photoPublicId: document.publicId,
      photoHash: createHash("sha256").update(file.buffer).digest("hex"),
    },
  };
}
export async function removeRecordPhoto(document: OnboardingDocument) {
  try {
    await documentStorage.remove(document);
  } catch {
    console.error("Could not remove unreferenced record photo", {
      publicId: document.publicId,
    });
  }
}
export function recordPhotoUrl(publicId: string | null) {
  if (!publicId) return null;
  return documentStorage.download({ publicId } as OnboardingDocument);
}
