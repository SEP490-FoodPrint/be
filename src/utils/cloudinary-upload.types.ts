export interface UploadFile {
  buffer: Buffer;
  size: number;
  mimeType: string;
  originalName: string;
}
export interface UploadContext {
  namespace: string;
  ownerId: string;
}
export type UploadFormat = "jpg" | "png" | "webp" | "pdf";
export interface ImageAsset {
  publicId: string;
  url: string;
  format: "jpg" | "png" | "webp";
  bytes: number;
  width: number;
  height: number;
}
export interface DocumentAsset {
  publicId: string;
  fileName: string;
  format: "jpg" | "png" | "pdf";
  bytes: number;
  resourceType: "raw";
  deliveryType: "authenticated";
}
export type UploadErrorCode =
  | "UPLOAD_FAILED"
  | "UPLOAD_TIMEOUT"
  | "UPLOAD_INVALID_RESULT"
  | "UPLOAD_COLLISION";
export type UploadItemResult<T> =
  | { index: number; status: "success"; asset: T }
  | {
      index: number;
      status: "failed";
      error: { code: UploadErrorCode; message: string };
    };
export interface UploadOptions {
  kind: "image" | "document";
  format: UploadFormat;
  publicId: string;
}
export interface UploadSession {
  upload(
    file: UploadFile,
    options: UploadOptions,
  ): Promise<ImageAsset | DocumentAsset>;
}
export interface UploadTransport {
  prepare(): UploadSession;
}
