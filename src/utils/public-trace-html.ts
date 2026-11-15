import type { PublicDeliveryTraceDTO } from "../modules/delivery-trace/delivery-trace.response.dto";

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function renderDocument(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="vi">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow, noarchive">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body{margin:0;padding:16px;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;line-height:1.5}",
    "main{max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}",
    "h1{margin:0 0 8px;font-size:1.2rem}",
    ".badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#e2e8f0;font-size:.875rem;font-weight:600}",
    "dl{margin:16px 0 0;display:grid;gap:12px}",
    ".row{border-top:1px solid #f1f5f9;padding-top:10px}",
    "dt{font-size:.8rem;color:#475569;margin-bottom:2px}",
    "dd{margin:0;font-weight:600;word-break:break-word}",
    "</style>",
    "</head>",
    `<body><main>${body}</main></body>`,
    "</html>",
  ].join("");
}

export function renderPublicTraceHtml(data: PublicDeliveryTraceDTO): string {
  const sourceCodeText = data.sourceFacility.facilityCode
    ? escapeHtml(data.sourceFacility.facilityCode)
    : "Chưa có mã cơ sở";

  const body = [
    `<header><h1>Truy xuất nguyên liệu giao hàng</h1><p class="badge" data-status="${escapeHtml(data.status)}">${escapeHtml(data.statusLabel)}</p></header>`,
    "<dl>",
    `<div class="row"><dt>Nhà cung cấp</dt><dd>${escapeHtml(data.supplierName)}</dd></div>`,
    `<div class="row"><dt>Mã đợt giao</dt><dd>${escapeHtml(data.deliveryNo)}</dd></div>`,
    `<div class="row"><dt>Nguyên liệu</dt><dd>${escapeHtml(data.ingredientName)}</dd></div>`,
    `<div class="row"><dt>Số lượng thực giao</dt><dd>${escapeHtml(data.actualQuantity)} ${escapeHtml(data.unit)}</dd></div>`,
    `<div class="row"><dt>Cơ sở cung cấp</dt><dd>${escapeHtml(data.sourceFacility.name)}</dd></div>`,
    `<div class="row"><dt>Mã cơ sở</dt><dd>${sourceCodeText}</dd></div>`,
    "</dl>",
  ].join("");

  return renderDocument(`Truy xuất nguyên liệu - ${data.deliveryNo}`, body);
}

export function renderPublicTraceErrorHtml(
  statusCode: number,
  message: string,
): string {
  const title =
    statusCode === 404
      ? "Không tìm thấy thông tin truy xuất"
      : "Thông báo truy xuất nguyên liệu";
  const body = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`;
  return renderDocument(title, body);
}
