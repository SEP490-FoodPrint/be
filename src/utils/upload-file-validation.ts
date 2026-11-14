import sharp from "sharp";
import { HttpError } from "./http-error";
import { RequestValidationError } from "./request-validation";
import type {
  UploadContext,
  UploadFile,
  UploadFormat,
} from "./cloudinary-upload.types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
function invalid(field: string, message: string): never {
  throw new RequestValidationError([{ field, message }]);
}
export function validateUploadContext(context: UploadContext): void {
  if (
    !context ||
    typeof context.namespace !== "string" ||
    context.namespace.length > 48 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(context.namespace) ||
    typeof context.ownerId !== "string" ||
    context.ownerId.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      context.ownerId,
    )
  )
    invalid("context", "Phạm vi tải tệp không hợp lệ");
}
export async function validateUploadFiles(
  files: UploadFile[],
  kind: "image" | "document",
): Promise<UploadFormat[]> {
  if (!Array.isArray(files) || files.length < 1 || files.length > 5)
    invalid("files", "Phải có từ 1 đến 5 tệp");
  const formats: UploadFormat[] = [];
  for (const [index, file] of files.entries()) {
    const field = `files.${index}`;
    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      !Number.isSafeInteger(file.size) ||
      file.size !== file.buffer.length ||
      !file.size ||
      typeof file.originalName !== "string"
    )
      invalid(field, "Tệp không hợp lệ");
    if (file.size > MAX_UPLOAD_BYTES)
      throw new HttpError(413, "Tệp vượt quá 5 MiB");
    if (
      kind === "document" &&
      file.mimeType === "application/pdf" &&
      file.buffer.subarray(0, 5).toString() === "%PDF-"
    ) {
      formats.push("pdf");
      continue;
    }
    const expected = (
      {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      } as Record<string, UploadFormat>
    )[file.mimeType];
    if (!expected || (kind === "document" && expected === "webp"))
      invalid(`${field}.mimeType`, "Định dạng tệp không được hỗ trợ");
    try {
      const instance = sharp(file.buffer, {
        animated: true,
        failOn: "warning",
      });
      const metadata = await instance.metadata();
      const actual = metadata.format === "jpeg" ? "jpg" : metadata.format;
      if (actual !== expected || !metadata.width || !metadata.height)
        invalid(field, "Nội dung tệp không khớp định dạng");
      await instance.stats();
    } catch (error) {
      if (error instanceof RequestValidationError) throw error;
      invalid(field, "Ảnh không hợp lệ hoặc không thể giải mã");
    }
    formats.push(expected);
  }
  return formats;
}
