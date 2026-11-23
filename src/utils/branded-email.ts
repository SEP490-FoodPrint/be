/**
 * Giao diện email FoodPrint dạng lá thư (dùng cho mọi email của hệ thống): khung rộng 343px,
 * cao theo nội dung; logo + tên dự án căn giữa, lời chào, các trường "Nhãn: giá trị" in đậm,
 * khối mã OTP, danh sách, nút rộng toàn khung và lời ký. Dùng bảng + CSS inline để hiển thị
 * đúng trên Gmail/Outlook. Mọi giá trị động đều được escape.
 */
import { readPublicTraceOrigin } from "../config/env";
import { EMAIL_LOGO_CID } from "./email-logo";

export const BRAND = {
  name: "FoodPrint",
  tagline: "Minh bạch bữa ăn học đường",
  primary: "#0a8066",
  primaryDark: "#065f4b",
  primarySoft: "#e8f5f1",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  page: "#f1f5f4",
} as const;

/** Chiều rộng khung thư (px); chiều cao theo nội dung. */
export const EMAIL_WIDTH = 343;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const multiline = (value: string) =>
  escapeHtml(value).replace(/\r?\n/g, "<br />");

function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/** Logo công khai (link ảnh https) nếu có cấu hình; không có thì dùng logo nhúng inline. */
export function readEmailLogoUrl(
  source: NodeJS.ProcessEnv = process.env,
): string | null {
  const url = safeUrl(source.EMAIL_LOGO_URL?.trim());
  return url && url.startsWith("https://") ? url : null;
}

/** Trang chủ giao diện FoodPrint cho nút trong email; thiếu cấu hình thì `null` (email bỏ nút). */
export function readEmailAppUrl(): string | null {
  try {
    return `${readPublicTraceOrigin()}/`;
  } catch {
    return null;
  }
}

/** Một trường thông tin trong thư: nhãn in đậm; `block` đặt giá trị xuống dòng (nội dung dài). */
export interface LetterField {
  label: string;
  value: string;
  block?: boolean;
}

/** Nội dung một email dạng lá thư. */
export interface LetterEmail {
  /** Tiêu đề trang HTML (không hiển thị trong thân thư). */
  title: string;
  /** Dòng xem trước hiện trong hộp thư (ẩn trong thân email). */
  preheader: string;
  greeting: string;
  intro: string[];
  /** Mã dùng một lần (OTP) hiển thị lớn, căn giữa, ngay sau phần mở đầu. */
  code?: { label: string; value: string; note?: string };
  fields?: LetterField[];
  /** Danh sách gạch đầu dòng, ví dụ các khối chưa tạo thực đơn. */
  bullets?: string[];
  outro?: string[];
  /** Dòng phụ nhỏ, màu nhạt, ngay trên nút. */
  note?: string;
  action?: { label: string; url: string };
}

export function renderLetterEmail(
  email: LetterEmail,
  options: { logoUrl?: string | null; year?: number } = {},
): { html: string; text: string } {
  const year = options.year ?? new Date().getFullYear();
  const actionUrl = safeUrl(email.action?.url);
  // Logo dự án nhúng inline (`cid:`, mailer đính kèm); `EMAIL_LOGO_URL` https có thể thay thế.
  const logoSrc = options.logoUrl
    ? escapeHtml(options.logoUrl)
    : `cid:${EMAIL_LOGO_CID}`;
  const paragraphStyle = `margin:0 0 14px;font-size:14px;line-height:1.6;color:${BRAND.text};`;
  const paragraph = (value: string) =>
    `<p style="${paragraphStyle}">${multiline(value)}</p>`;
  const fieldsHtml = (email.fields ?? [])
    .map(
      (field) =>
        `<p style="${paragraphStyle}"><strong>${escapeHtml(field.label)}:</strong>${field.block ? "<br />" : " "}${multiline(field.value)}</p>`,
    )
    .join("");
  const codeHtml = email.code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;">
            <tr><td align="center" style="padding:16px 12px;background:${BRAND.primarySoft};border-radius:10px;">
              <div style="font-size:12px;font-weight:700;color:${BRAND.muted};">${escapeHtml(email.code.label)}</div>
              <div style="margin-top:6px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:0.25em;color:${BRAND.primaryDark};">${escapeHtml(email.code.value)}</div>
              ${email.code.note ? `<div style="margin-top:6px;font-size:12px;line-height:1.5;color:${BRAND.muted};">${escapeHtml(email.code.note)}</div>` : ""}
            </td></tr>
          </table>`
    : "";
  const bulletsHtml = email.bullets?.length
    ? `<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.6;color:${BRAND.text};">${email.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  const actionHtml =
    actionUrl && email.action
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;">
            <tr><td align="center" style="border-radius:10px;background:${BRAND.primary};">
              <a href="${escapeHtml(actionUrl)}" target="_blank" rel="noopener" style="display:block;padding:12px 16px;font-size:14px;font-weight:700;line-height:1.4;color:#ffffff;text-decoration:none;border-radius:10px;text-align:center;">${escapeHtml(email.action.label)}</a>
            </td></tr>
          </table>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(email.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <div style="display:none;mso-hide:all;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(email.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:24px 8px;">
    <tr><td align="center">
      <table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${EMAIL_WIDTH}px;">
        <tr><td style="background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;padding:24px 20px 20px;">
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;"><tr>
            <td style="vertical-align:middle;"><img src="${logoSrc}" width="40" height="40" alt="${BRAND.name}" style="display:block;width:40px;height:40px;border:0;" /></td>
            <td style="vertical-align:middle;padding-left:8px;">
              <div style="font-size:20px;line-height:1.15;font-weight:800;color:${BRAND.primaryDark};letter-spacing:-0.01em;">${BRAND.name}</div>
              <div style="font-size:11px;line-height:1.4;color:${BRAND.muted};">${BRAND.tagline}</div>
            </td>
          </tr></table>
          ${paragraph(email.greeting)}
          ${email.intro.map(paragraph).join("")}
          ${codeHtml}
          ${fieldsHtml}
          ${bulletsHtml}
          ${(email.outro ?? []).map(paragraph).join("")}
          ${email.note ? `<p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:${BRAND.muted};">${multiline(email.note)}</p>` : ""}
          ${actionHtml}
          <p style="margin:0;font-size:14px;line-height:1.6;color:${BRAND.text};">Trân trọng,<br />${BRAND.name}.</p>
        </td></tr>
        <tr><td style="padding:16px 8px;text-align:center;font-size:11px;line-height:1.6;color:${BRAND.muted};">
          Email tự động từ hệ thống ${BRAND.name}, vui lòng không trả lời email này.<br />
          &copy; ${year} ${BRAND.name} · ${BRAND.tagline}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    email.greeting,
    "",
    ...email.intro.flatMap((item) => [item, ""]),
    ...(email.code
      ? [
          `${email.code.label}: ${email.code.value}`,
          ...(email.code.note ? [email.code.note] : []),
          "",
        ]
      : []),
    ...(email.fields ?? []).flatMap((field) => [
      field.block
        ? `${field.label}:\n${field.value}`
        : `${field.label}: ${field.value}`,
      "",
    ]),
    ...(email.bullets?.length
      ? [...email.bullets.map((item) => `- ${item}`), ""]
      : []),
    ...(email.outro ?? []).flatMap((item) => [item, ""]),
    ...(email.note ? [email.note, ""] : []),
    ...(actionUrl && email.action
      ? [`${email.action.label}: ${actionUrl}`, ""]
      : []),
    "Trân trọng,",
    `${BRAND.name}.`,
    "",
    `Email tự động từ hệ thống ${BRAND.name}, vui lòng không trả lời.`,
  ].join("\n");

  return { html, text };
}
