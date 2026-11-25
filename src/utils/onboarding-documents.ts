import { createHash, randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import type { UploadApiResponse } from "cloudinary";
import { HttpError } from "./http-error";
import { uuid } from "./auth-validation";
import type { OnboardingProfile } from "../modules/auth/onboarding.validation";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_PROFILE_DOCUMENTS = 20;
export interface OnboardingDocument {
  id: string;
  field: string;
  publicId: string;
  format: "pdf" | "png" | "jpg";
  fileName: string;
  bytes: number;
  /** SHA-256 of the file bytes (hex); absent on documents uploaded before UC-01/02 proofs. */
  sha256?: string;
}
export function documentSha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
export interface DocumentStorage {
  upload(
    userId: string,
    file: Express.Multer.File,
  ): Promise<OnboardingDocument>;
  remove(document: OnboardingDocument): Promise<void>;
  download(document: OnboardingDocument): string;
}
function configuredCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (
    !CLOUDINARY_CLOUD_NAME ||
    !CLOUDINARY_API_KEY ||
    !CLOUDINARY_API_SECRET ||
    [CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET].some(
      (value) => value.startsWith("replace-"),
    )
  )
    throw new HttpError(503, "Chưa lưu được tệp. Vui lòng thử lại sau.");
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  return cloudinary;
}
export function documentFormat(
  file: Express.Multer.File,
): OnboardingDocument["format"] {
  if (!file.size || file.size > MAX_DOCUMENT_BYTES)
    throw new HttpError(413, "Tệp không được rỗng, tối đa 5 MB.");
  const data = file.buffer;
  if (
    file.mimetype === "application/pdf" &&
    data.subarray(0, 5).toString() === "%PDF-"
  )
    return "pdf";
  if (
    file.mimetype === "image/png" &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    file.mimetype === "image/jpeg" &&
    data[0] === 255 &&
    data[1] === 216 &&
    data[2] === 255
  )
    return "jpg";
  throw new HttpError(400, "Chỉ nhận PDF, PNG hoặc JPEG.");
}
export function validateProfileFiles(
  files: Express.Multer.File[],
  profile: OnboardingProfile,
): void {
  const allowed = new Set(
    profile.requestType === "SCHOOL"
      ? ["legalDocument"]
      : profile.profileData.certifications.map((_, i) => `certificate_${i}`),
  );
  if (files.length > MAX_PROFILE_DOCUMENTS)
    throw new HttpError(
      400,
      `Hồ sơ chỉ nhận tối đa ${MAX_PROFILE_DOCUMENTS} tệp`,
    );
  for (const file of files) {
    if (!allowed.has(file.fieldname))
      throw new HttpError(400, "Tệp không thuộc hồ sơ.");
    documentFormat(file);
  }
}
export function readDocuments(
  value: unknown,
  userId: string,
): OnboardingDocument[] {
  if (!Array.isArray(value) || value.length > MAX_PROFILE_DOCUMENTS)
    throw new HttpError(503, "Tài liệu không hợp lệ.");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object")
      throw new HttpError(503, "Tài liệu không hợp lệ.");
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.field !== "string" ||
      !["pdf", "png", "jpg"].includes(String(row.format)) ||
      row.publicId !==
        `foodprint/onboarding/${uuid(userId)}/${row.id}.${String(row.format)}` ||
      typeof row.fileName !== "string" ||
      typeof row.bytes !== "number" ||
      (row.sha256 !== undefined &&
        (typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)))
    )
      throw new HttpError(503, "Tài liệu không hợp lệ.");
    return {
      id: uuid(row.id),
      field: row.field,
      publicId: String(row.publicId),
      format: row.format as OnboardingDocument["format"],
      fileName: row.fileName,
      bytes: row.bytes,
      ...(typeof row.sha256 === "string" ? { sha256: row.sha256 } : {}),
    };
  });
}
export const documentStorage: DocumentStorage = {
  async upload(userId, file) {
    const format = documentFormat(file);
    const id = randomUUID();
    const publicId = `foodprint/onboarding/${uuid(userId)}/${id}.${format}`;
    try {
      const sdk = configuredCloudinary();
      await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = sdk.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: "raw",
            type: "authenticated",
            overwrite: false,
            timeout: 30000,
          },
          (error, result) => {
            if (error || !result) reject(new Error("Document upload failed"));
            else resolve(result);
          },
        );
        stream.on("error", reject);
        stream.end(file.buffer);
      });
      return {
        id,
        field: file.fieldname,
        publicId,
        format,
        fileName: [...file.originalname]
          .map((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code < 32 ||
              code === 127 ||
              character === "/" ||
              character === "\\"
              ? "_"
              : character;
          })
          .join("")
          .slice(0, 255),
        bytes: file.size,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "Chưa lưu được tệp. Vui lòng thử lại sau.");
    }
  },
  async remove(document) {
    await configuredCloudinary().uploader.destroy(document.publicId, {
      resource_type: "raw",
      type: "authenticated",
    });
  },
  download(document) {
    return configuredCloudinary().utils.private_download_url(
      document.publicId,
      "",
      {
        resource_type: "raw",
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: false,
      },
    );
  },
};
