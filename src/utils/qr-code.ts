import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

export const DELIVERY_ITEM_QR_TOKEN_BYTES = 32;
export const DELIVERY_ITEM_QR_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const PUBLIC_DELIVERY_ITEM_PATH_PREFIX = "/api/public/delivery-items/";

export const DELIVERY_QR_IMAGE_OPTIONS: QRCode.QRCodeToDataURLOptions = {
  type: "image/png",
  width: 384,
  margin: 4,
  errorCorrectionLevel: "M",
};

export const DELIVERY_QR_MAX_CONCURRENCY = 4;

export type QrDataUrlRenderer = (
  text: string,
  options: QRCode.QRCodeToDataURLOptions,
) => Promise<string>;

const defaultQrRenderer: QrDataUrlRenderer = (text, options) =>
  QRCode.toDataURL(text, options);

export function generateDeliveryQrToken(): string {
  return randomBytes(DELIVERY_ITEM_QR_TOKEN_BYTES).toString("hex");
}

export function isValidDeliveryQrToken(token: string): boolean {
  return DELIVERY_ITEM_QR_TOKEN_PATTERN.test(token);
}

export function buildDeliveryTraceUrl(
  publicTraceOrigin: string,
  token: string,
): string {
  const origin = publicTraceOrigin.trim().replace(/\/+$/, "");
  if (!origin) {
    throw new Error("Origin truy xuất công khai không hợp lệ");
  }
  const parsed = new URL(origin);
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !["http:", "https:"].includes(parsed.protocol)
  ) {
    throw new Error("Origin truy xuất công khai không hợp lệ");
  }
  if (!isValidDeliveryQrToken(token)) {
    throw new Error("QR token dòng giao hàng không hợp lệ");
  }
  return `${parsed.origin}${PUBLIC_DELIVERY_ITEM_PATH_PREFIX}${token}`;
}

export async function renderDeliveryQrDataUrl(
  traceUrl: string,
  renderer: QrDataUrlRenderer = defaultQrRenderer,
): Promise<string> {
  const normalized = traceUrl.trim();
  if (!normalized) {
    throw new Error("URL QR không được để trống");
  }
  new URL(normalized);
  const dataUrl = await renderer(normalized, {
    ...DELIVERY_QR_IMAGE_OPTIONS,
  });
  if (
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/png;base64,")
  ) {
    throw new Error("Không thể tạo ảnh PNG QR hợp lệ");
  }
  return dataUrl;
}

export async function renderDeliveryQrBatch(
  traceUrls: readonly string[],
  options?: {
    concurrency?: number;
    renderer?: QrDataUrlRenderer;
  },
): Promise<string[]> {
  if (traceUrls.length === 0) {
    return [];
  }
  const requested = options?.concurrency ?? DELIVERY_QR_MAX_CONCURRENCY;
  const concurrency = Math.max(
    1,
    Math.min(DELIVERY_QR_MAX_CONCURRENCY, Math.trunc(requested)),
  );
  const renderer = options?.renderer ?? defaultQrRenderer;
  const results = new Array<string>(traceUrls.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < traceUrls.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await renderDeliveryQrDataUrl(
        traceUrls[index],
        renderer,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, traceUrls.length) }, () =>
      worker(),
    ),
  );
  return results;
}
