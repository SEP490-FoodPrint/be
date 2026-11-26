import { createHash, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import type { UploadApiResponse } from "cloudinary";
import { z } from "zod";
import { HttpError } from "./http-error";
import { RequestValidationError } from "./request-validation";

/**
 * File chứng cứ đính kèm (ảnh/PDF) cho khiếu nại (specs/complaint-attachments, plan v6 Q29–Q31).
 * Lưu Cloudinary dạng raw + authenticated; chỉ xem qua URL ký có hạn.
 */
export const MAX_EVIDENCE_FILES = 5;
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_URL_TTL_SECONDS = 600;
export const EVIDENCE_FIELD = "files";

export const EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number];

const EXTENSIONS: Record<EvidenceMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Thư mục gốc theo miền nghiệp vụ (`foodprint/<area>/<ownerId>/...`). */
export type EvidenceArea = "complaints" | "food-safety-incidents";

/** File đã nhận từ multipart, chưa lưu. */
export interface EvidenceFile {
  buffer: Buffer;
  size: number;
  mimeType: string;
  originalName: string;
}

/** File đã lưu, sẵn sàng ghi vào DB. */
export interface StoredEvidence {
  publicId: string;
  mimeType: EvidenceMimeType;
  sizeBytes: number;
  fileName: string;
  sha256: string;
}

export interface EvidenceStorage {
  upload(file: EvidenceFile, publicId: string): Promise<void>;
  remove(publicId: string): Promise<void>;
  url(publicId: string): string;
}

/** Mảng file trong Request DTO; nội dung (magic bytes) kiểm tra ở `detectEvidenceMime`. */
export const evidenceFilesSchema = z
  .array(
    z.strictObject({
      buffer: z.instanceof(Buffer, { error: "Tệp không hợp lệ" }),
      size: z.number().int().positive({ error: "Tệp không có dữ liệu" }),
      mimeType: z.string(),
      originalName: z.string(),
    }),
    { error: "Danh sách tệp không hợp lệ" },
  )
  .max(MAX_EVIDENCE_FILES, {
    error: `Chỉ được đính kèm tối đa ${MAX_EVIDENCE_FILES} tệp`,
  })
  .optional();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_EVIDENCE_BYTES + 1,
    files: MAX_EVIDENCE_FILES + 1,
    fields: 10,
    parts: MAX_EVIDENCE_FILES + 11,
    fieldNameSize: 64,
    fieldSize: 64 * 1024,
  },
}).array(EVIDENCE_FIELD, MAX_EVIDENCE_FILES + 1);

/**
 * Nhận `multipart/form-data` (trường file `files` + các trường văn bản vào `req.body`).
 * Request JSON đi tiếp như cũ, không có file.
 */
export const receiveEvidenceFiles: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(
        error.code === "LIMIT_FILE_SIZE"
          ? new HttpError(413, "Mỗi tệp chỉ được tối đa 5 MiB")
          : new HttpError(
              400,
              error.code === "LIMIT_FILE_COUNT" ||
                error.code === "LIMIT_UNEXPECTED_FILE"
                ? `Chỉ được đính kèm tối đa ${MAX_EVIDENCE_FILES} tệp ở trường "${EVIDENCE_FIELD}"`
                : "Nội dung multipart không hợp lệ hoặc vượt giới hạn",
            ),
      );
      return;
    }
    if (error) {
      next(new HttpError(400, "Nội dung multipart không hợp lệ"));
      return;
    }
    // multer tạo body không có prototype; chuyển về object thường cho Zod.
    req.body = { ...(req.body as Record<string, unknown>) };
    next();
  });
};

/** Đọc file multer từ request thành `EvidenceFile[]` (controller). */
export function evidenceFilesOf(files: unknown): EvidenceFile[] {
  if (!Array.isArray(files)) return [];
  return (files as Express.Multer.File[]).map((file) => ({
    buffer: file.buffer,
    size: file.size,
    mimeType: file.mimetype,
    originalName: file.originalname,
  }));
}

/** Xác định loại file theo MIME khai báo + magic bytes; sai ⇒ 400/413. */
export function detectEvidenceMime(
  file: EvidenceFile,
  index: number,
): EvidenceMimeType {
  const field = `files.${index}`;
  if (!file.size || file.size !== file.buffer.length)
    throw new RequestValidationError([{ field, message: "Tệp không hợp lệ" }]);
  if (file.size > MAX_EVIDENCE_BYTES)
    throw new HttpError(413, "Mỗi tệp chỉ được tối đa 5 MiB");
  const data = file.buffer;
  const matches: Record<EvidenceMimeType, boolean> = {
    "application/pdf": data.subarray(0, 5).toString("latin1") === "%PDF-",
    "image/png": data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    "image/webp":
      data.subarray(0, 4).toString("latin1") === "RIFF" &&
      data.subarray(8, 12).toString("latin1") === "WEBP",
  };
  const mime = file.mimeType as EvidenceMimeType;
  if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(mime))
    throw new RequestValidationError([
      {
        field: `${field}.mimeType`,
        message: "Chỉ nhận ảnh JPG, PNG, WEBP hoặc tệp PDF",
      },
    ]);
  if (!matches[mime])
    throw new RequestValidationError([
      { field, message: "Nội dung tệp không khớp định dạng" },
    ]);
  return mime;
}

function safeFileName(name: string, mime: EvidenceMimeType): string {
  const cleaned = Array.from(name.normalize("NFC"))
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
    .trim();
  const chars = Array.from(cleaned);
  return chars.length
    ? chars.slice(0, 255).join("")
    : `tep-dinh-kem.${EXTENSIONS[mime]}`;
}

function configuredCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (
    !CLOUDINARY_CLOUD_NAME ||
    !CLOUDINARY_API_KEY ||
    !CLOUDINARY_API_SECRET ||
    [CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET].some(
      (value) => !value.trim() || value.startsWith("replace-"),
    )
  )
    throw new HttpError(
      503,
      "Chưa cấu hình Cloudinary để lưu tệp đính kèm",
      "UPLOAD_NOT_CONFIGURED",
    );
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  return cloudinary;
}

export const cloudinaryEvidenceStorage: EvidenceStorage = {
  async upload(file, publicId) {
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
          if (error || !result) reject(new Error("Evidence upload failed"));
          else if ((result as { existing?: boolean }).existing)
            reject(new Error("Evidence public id collision"));
          else resolve(result);
        },
      );
      stream.on("error", reject);
      stream.end(file.buffer);
    });
  },
  async remove(publicId) {
    await configuredCloudinary().uploader.destroy(publicId, {
      resource_type: "raw",
      type: "authenticated",
    });
  },
  url(publicId) {
    return configuredCloudinary().utils.private_download_url(publicId, "", {
      resource_type: "raw",
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + EVIDENCE_URL_TTL_SECONDS,
      attachment: false,
    });
  },
};

/** URL ký có hạn để xem file; lỗi cấu hình/ký ⇒ `null` (không làm hỏng việc đọc hồ sơ). */
export function signedEvidenceUrl(
  storage: Pick<EvidenceStorage, "url">,
  publicId: string,
): string | null {
  try {
    return storage.url(publicId);
  } catch {
    return null;
  }
}

/** Xóa file đã upload nhưng không được ghi vào DB; lỗi chỉ ghi log. */
export async function discardEvidenceFiles(
  storage: EvidenceStorage,
  stored: readonly StoredEvidence[],
): Promise<void> {
  for (const item of stored) {
    try {
      await storage.remove(item.publicId);
    } catch {
      console.error("Could not remove unreferenced evidence file", {
        publicId: item.publicId,
      });
    }
  }
}

/**
 * Kiểm tra toàn bộ file rồi mới upload tuần tự; một file lỗi ⇒ xóa các file đã upload và trả 503.
 * Đường dẫn: `foodprint/<area>/<ownerId>/<uuid>.<ext>` (mặc định area `complaints`).
 */
export async function storeEvidenceFiles(
  storage: EvidenceStorage,
  files: readonly EvidenceFile[],
  ownerId: string,
  idFactory: () => string = randomUUID,
  area: EvidenceArea = "complaints",
): Promise<StoredEvidence[]> {
  if (files.length > MAX_EVIDENCE_FILES)
    throw new RequestValidationError([
      {
        field: EVIDENCE_FIELD,
        message: `Chỉ được đính kèm tối đa ${MAX_EVIDENCE_FILES} tệp`,
      },
    ]);
  const mimes = files.map((file, index) => detectEvidenceMime(file, index));
  const stored: StoredEvidence[] = [];
  for (const [index, file] of files.entries()) {
    const mime = mimes[index];
    const publicId = `foodprint/${area}/${ownerId}/${idFactory()}.${EXTENSIONS[mime]}`;
    try {
      await storage.upload(file, publicId);
    } catch (error) {
      await discardEvidenceFiles(storage, stored);
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "Không thể tải tệp đính kèm lên dịch vụ lưu trữ",
      );
    }
    stored.push({
      publicId,
      mimeType: mime,
      sizeBytes: file.size,
      fileName: safeFileName(file.originalName, mime),
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
    });
  }
  return stored;
}

/**
 * Upload file trước, chạy thao tác (transaction) sau; thao tác lỗi ⇒ xóa file vừa upload.
 * Không có file thì chỉ chạy thao tác.
 */
export async function withStoredEvidence<T>(
  storage: EvidenceStorage,
  files: readonly EvidenceFile[] | undefined,
  ownerId: string,
  run: (stored: StoredEvidence[]) => Promise<T>,
  area: EvidenceArea = "complaints",
): Promise<T> {
  const stored = files?.length
    ? await storeEvidenceFiles(storage, files, ownerId, randomUUID, area)
    : [];
  try {
    return await run(stored);
  } catch (error) {
    await discardEvidenceFiles(storage, stored);
    throw error;
  }
}
