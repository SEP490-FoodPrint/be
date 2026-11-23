/**
 * Dựng URL hiển thị ảnh Cloudinary (specs/cloudinary-image-url): nhận URL `secure_url` đã lưu
 * hoặc `publicId`, chỉ chấp nhận ảnh công khai (`image/upload`) của cloud đã cấu hình, rồi chèn
 * phép biến đổi resize/nén. Hàm thuần: không gọi mạng, không cần API key/secret.
 */

export type CloudinaryCrop = "fill" | "fit" | "limit" | "pad" | "thumb";
export type CloudinaryGravity = "auto" | "center" | "face";
export type CloudinaryFormat = "auto" | "jpg" | "png" | "webp";

export interface CloudinaryImageOptions {
  /** Chiều rộng (px), số nguyên 1–4000. */
  width?: number;
  /** Chiều cao (px), số nguyên 1–4000. */
  height?: number;
  /** Cách cắt/thu phóng; mặc định `limit` (chỉ thu nhỏ, giữ tỉ lệ) khi có kích thước. */
  crop?: CloudinaryCrop;
  /** Điểm neo khi cắt; chỉ dùng với `fill`/`thumb`. */
  gravity?: CloudinaryGravity;
  /** Định dạng giao ảnh; mặc định `auto` (WebP/AVIF theo trình duyệt). */
  format?: CloudinaryFormat;
  /** Chất lượng: `auto` (mặc định) hoặc 1–100. */
  quality?: "auto" | number;
}

const HOST = "res.cloudinary.com";
const MAX_SIZE = 4000;
const PUBLIC_ID =
  /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_\-./]+$/;
const VERSION = /^v\d+$/;
const CLOUD_NAME = /^[A-Za-z0-9_-]+$/;

function readCloudName(source: NodeJS.ProcessEnv): string | null {
  const cloud = source.CLOUDINARY_CLOUD_NAME?.trim();
  return cloud && !cloud.startsWith("replace-") && CLOUD_NAME.test(cloud)
    ? cloud
    : null;
}

function size(name: string, value: number | undefined): string | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SIZE)
    throw new RangeError(`${name} phải là số nguyên 1–${MAX_SIZE}`);
  return String(value);
}

/** Chuỗi biến đổi Cloudinary, ví dụ `c_fill,g_auto,w_320,h_240,q_auto,f_auto`. */
export function cloudinaryTransformation(
  options: CloudinaryImageOptions = {},
): string {
  const width = size("width", options.width);
  const height = size("height", options.height);
  const crop = options.crop ?? (width || height ? "limit" : undefined);
  if (options.gravity && crop !== "fill" && crop !== "thumb")
    throw new RangeError("gravity chỉ dùng với crop fill hoặc thumb");
  const quality = options.quality ?? "auto";
  if (
    quality !== "auto" &&
    (!Number.isInteger(quality) || quality < 1 || quality > 100)
  )
    throw new RangeError("quality phải là auto hoặc số nguyên 1–100");
  return [
    crop && `c_${crop}`,
    options.gravity && `g_${options.gravity}`,
    width && `w_${width}`,
    height && `h_${height}`,
    `q_${quality}`,
    `f_${options.format ?? "auto"}`,
  ]
    .filter(Boolean)
    .join(",");
}

/** Tách phần sau `image/upload/` của URL Cloudinary thuộc `cloud`; bỏ biến đổi cũ đứng trước version. */
function deliveryPath(source: string, cloud: string): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  const prefix = `/${cloud}/image/upload/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix)
  )
    return null;
  let segments: string[];
  try {
    segments = url.pathname
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const version = segments.findIndex((segment) => VERSION.test(segment));
  const rest = version >= 0 ? segments.slice(version) : segments;
  const path = rest.join("/");
  const publicPath = version >= 0 ? rest.slice(1).join("/") : path;
  return publicPath && PUBLIC_ID.test(publicPath) ? path : null;
}

/**
 * URL ảnh Cloudinary đã resize/nén từ `secure_url` đã lưu hoặc `publicId`.
 * Trả về `null` khi nguồn không phải ảnh công khai của cloud đã cấu hình (hoặc chưa cấu hình
 * `CLOUDINARY_CLOUD_NAME`); tùy chọn sai (lỗi lập trình) ném `RangeError`.
 */
export function cloudinaryImageUrl(
  source: string | null | undefined,
  options: CloudinaryImageOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const transformation = cloudinaryTransformation(options);
  const value = source?.trim();
  const cloud = readCloudName(env);
  if (!value || !cloud) return null;
  const path = value.startsWith("https://")
    ? deliveryPath(value, cloud)
    : PUBLIC_ID.test(value)
      ? value
      : null;
  if (!path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://${HOST}/${cloud}/image/upload/${transformation}/${encoded}`;
}
