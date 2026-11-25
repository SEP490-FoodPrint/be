import multer from "multer";
import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error";

function createUpload(field: string, maxFiles: number): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024 + 1,
      files: maxFiles,
      fields: 0,
      parts: maxFiles + 1,
      fieldNameSize: 64,
    },
  }).array(field, maxFiles);
  return (req, res, next) => {
    if (!req.is("multipart/form-data")) {
      next(new HttpError(400, "Tệp gửi lên không hợp lệ."));
      return;
    }
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(
          new HttpError(
            error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
            "Tệp tải lên không hợp lệ hoặc vượt giới hạn",
          ),
        );
      } else if (error) {
        next(new HttpError(400, "Tệp gửi lên không hợp lệ."));
      } else {
        const files = Array.isArray(req.files) ? req.files : [];
        if (files.some((file) => file.size > 5 * 1024 * 1024)) {
          next(new HttpError(413, "Tệp tối đa 5 MB."));
          return;
        }
        next();
      }
    });
  };
}
export const ingredientSingleUpload = createUpload("image", 1);
export const ingredientMultipleUpload = createUpload("images", 5);
