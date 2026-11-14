import { randomUUID } from "node:crypto";
import { cloudinaryTransport, uploadFailure } from "./cloudinary-client";
import {
  validateUploadContext,
  validateUploadFiles,
} from "./upload-file-validation";
import { HttpError } from "./http-error";
import type {
  DocumentAsset,
  ImageAsset,
  UploadContext,
  UploadErrorCode,
  UploadFile,
  UploadFormat,
  UploadItemResult,
  UploadOptions,
  UploadSession,
  UploadTransport,
} from "./cloudinary-upload.types";

export function createCloudinaryUpload(
  transport: UploadTransport = cloudinaryTransport,
  idFactory: () => string = randomUUID,
) {
  async function prepare(
    files: UploadFile[],
    context: UploadContext,
    kind: "image" | "document",
  ) {
    validateUploadContext(context);
    const formats = await validateUploadFiles(files, kind);
    const session = transport.prepare();
    return { formats, session };
  }
  function options(
    context: UploadContext,
    kind: "image" | "document",
    format: UploadFormat,
  ): UploadOptions {
    const id = idFactory();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw uploadFailure("UPLOAD_FAILED");
    return {
      kind,
      format,
      publicId: `foodprint/uploads/${context.namespace}/${context.ownerId}/${id}${kind === "document" ? `.${format}` : ""}`,
    };
  }
  function safeError(error: unknown): HttpError {
    const codes: UploadErrorCode[] = [
      "UPLOAD_FAILED",
      "UPLOAD_TIMEOUT",
      "UPLOAD_INVALID_RESULT",
      "UPLOAD_COLLISION",
    ];
    return error instanceof HttpError &&
      codes.includes(error.code as UploadErrorCode)
      ? uploadFailure(error.code as UploadErrorCode)
      : uploadFailure("UPLOAD_FAILED");
  }
  async function one<T extends ImageAsset | DocumentAsset>(
    file: UploadFile,
    context: UploadContext,
    kind: "image" | "document",
  ): Promise<T> {
    const { formats, session } = await prepare([file], context, kind);
    try {
      return (await session.upload(
        file,
        options(context, kind, formats[0]),
      )) as T;
    } catch (error) {
      throw safeError(error);
    }
  }
  async function many<T extends ImageAsset | DocumentAsset>(
    files: UploadFile[],
    context: UploadContext,
    kind: "image" | "document",
  ): Promise<UploadItemResult<T>[]> {
    const { formats, session } = await prepare(files, context, kind);
    const results: UploadItemResult<T>[] = Array.from<
      UploadFile,
      UploadItemResult<T>
    >(files, (_, index) => ({
      index,
      status: "failed",
      error: {
        code: "UPLOAD_FAILED",
        message: "Không thể tải tệp lên dịch vụ lưu trữ",
      },
    }));
    let next = 0;
    async function worker(session: UploadSession) {
      for (;;) {
        const index = next++;
        if (index >= files.length) return;
        try {
          const asset = await session.upload(
            files[index],
            options(context, kind, formats[index]),
          );
          results[index] = { index, status: "success", asset: asset as T };
        } catch (error) {
          const safe = safeError(error);
          results[index] = {
            index,
            status: "failed",
            error: {
              code: safe.code as UploadErrorCode,
              message: safe.message,
            },
          };
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(2, files.length) }, () => worker(session)),
    );
    return results;
  }
  return {
    uploadImage: (file: UploadFile, context: UploadContext) =>
      one<ImageAsset>(file, context, "image"),
    uploadImages: (files: UploadFile[], context: UploadContext) =>
      many<ImageAsset>(files, context, "image"),
    uploadDocument: (file: UploadFile, context: UploadContext) =>
      one<DocumentAsset>(file, context, "document"),
    uploadDocuments: (files: UploadFile[], context: UploadContext) =>
      many<DocumentAsset>(files, context, "document"),
  };
}
export const cloudinaryUpload = createCloudinaryUpload();
export const { uploadImage, uploadImages, uploadDocument, uploadDocuments } =
  cloudinaryUpload;
