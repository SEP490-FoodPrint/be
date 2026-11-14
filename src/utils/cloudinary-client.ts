import { v2 as cloudinary } from "cloudinary";
import type { UploadApiResponse } from "cloudinary";
import { HttpError } from "./http-error";
import type {
  DocumentAsset,
  ImageAsset,
  UploadFile,
  UploadOptions,
  UploadSession,
  UploadTransport,
} from "./cloudinary-upload.types";

export function uploadFailure(
  code:
    | "UPLOAD_FAILED"
    | "UPLOAD_TIMEOUT"
    | "UPLOAD_INVALID_RESULT"
    | "UPLOAD_COLLISION",
): HttpError {
  const messages = {
    UPLOAD_FAILED: "Không thể tải tệp lên dịch vụ lưu trữ",
    UPLOAD_TIMEOUT: "Quá thời gian tải tệp lên dịch vụ lưu trữ",
    UPLOAD_INVALID_RESULT: "Kết quả tải tệp không hợp lệ",
    UPLOAD_COLLISION: "Định danh tệp đã tồn tại",
  };
  return new HttpError(503, messages[code], code);
}
function validSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function mapResult(
  result: UploadApiResponse,
  file: UploadFile,
  options: UploadOptions,
  cloud: string,
): ImageAsset | DocumentAsset {
  if ((result as UploadApiResponse & { existing?: boolean }).existing)
    throw uploadFailure("UPLOAD_COLLISION");
  const resourceType = options.kind === "image" ? "image" : "raw";
  const deliveryType = options.kind === "image" ? "upload" : "authenticated";
  if (
    result.public_id !== options.publicId ||
    result.resource_type !== resourceType ||
    result.type !== deliveryType ||
    !validSize(result.bytes) ||
    result.bytes > 5 * 1024 * 1024
  )
    throw uploadFailure("UPLOAD_INVALID_RESULT");
  if (options.kind === "document") {
    if (options.format === "webp") throw uploadFailure("UPLOAD_INVALID_RESULT");
    return {
      publicId: options.publicId,
      fileName: [...file.originalName]
        .map((c) =>
          c.charCodeAt(0) < 32 ||
          c.charCodeAt(0) === 127 ||
          c === "/" ||
          c === "\\"
            ? "_"
            : c,
        )
        .join("")
        .slice(0, 255),
      format: options.format,
      bytes: result.bytes,
      resourceType: "raw",
      deliveryType: "authenticated",
    };
  }
  if (
    options.format === "pdf" ||
    result.format !== options.format ||
    !validSize(result.width) ||
    !validSize(result.height) ||
    typeof result.secure_url !== "string" ||
    result.secure_url.length > 2048
  )
    throw uploadFailure("UPLOAD_INVALID_RESULT");
  try {
    const url = new URL(result.secure_url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com" ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith(`/${cloud}/image/upload/`) ||
      !url.pathname.endsWith(`/${options.publicId}.${options.format}`)
    )
      throw new Error("invalid");
  } catch {
    throw uploadFailure("UPLOAD_INVALID_RESULT");
  }
  return {
    publicId: options.publicId,
    url: result.secure_url,
    format: options.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  };
}
export const cloudinaryTransport: UploadTransport = {
  prepare(): UploadSession {
    const {
      CLOUDINARY_CLOUD_NAME: cloud,
      CLOUDINARY_API_KEY: key,
      CLOUDINARY_API_SECRET: secret,
    } = process.env;
    if (
      !cloud ||
      !key ||
      !secret ||
      [cloud, key, secret].some((v) => !v.trim() || v.startsWith("replace-"))
    )
      throw new HttpError(
        503,
        "Chưa cấu hình Cloudinary",
        "UPLOAD_NOT_CONFIGURED",
      );
    return {
      async upload(file, options) {
        const response = await new Promise<UploadApiResponse>(
          (resolve, reject) => {
            let settled = false;
            let stream:
              ReturnType<typeof cloudinary.uploader.upload_stream> | undefined;
            const finish = (error?: Error, result?: UploadApiResponse) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              if (error || !result)
                reject(error ?? uploadFailure("UPLOAD_FAILED"));
              else resolve(result);
            };
            const timer = setTimeout(() => {
              finish(uploadFailure("UPLOAD_TIMEOUT"));
              stream?.destroy();
            }, 30000);
            try {
              stream = cloudinary.uploader.upload_stream(
                {
                  cloud_name: cloud,
                  api_key: key,
                  api_secret: secret,
                  public_id: options.publicId,
                  resource_type: options.kind === "image" ? "image" : "raw",
                  type: options.kind === "image" ? "upload" : "authenticated",
                  overwrite: false,
                  timeout: 30000,
                },
                (error, result) =>
                  finish(
                    error ? uploadFailure("UPLOAD_FAILED") : undefined,
                    result,
                  ),
              );
              stream.on("error", () => finish(uploadFailure("UPLOAD_FAILED")));
              stream.end(file.buffer);
            } catch {
              finish(uploadFailure("UPLOAD_FAILED"));
            }
          },
        );
        return mapResult(response, file, options, cloud);
      },
    };
  },
};
