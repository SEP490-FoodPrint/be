/**
 * Giao diện email thương hiệu FoodPrint: đầu thư xanh lá có logo/tên dự án, thẻ nội dung trắng,
 * bảng thông tin, khung nhấn mạnh, nút hành động và chân thư. Dùng bảng + CSS inline để hiển thị
 * đúng trên Gmail/Outlook. Mọi giá trị động đều được escape.
 */
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

export type EmailTone = "success" | "warning" | "danger" | "info";

const TONES: Record<
  EmailTone,
  { bg: string; border: string; text: string; label: string }
> = {
  success: {
    bg: "#ecfdf5",
    border: "#a7f3d0",
    text: "#047857",
    label: "Thành công",
  },
  warning: {
    bg: "#fffbeb",
    border: "#fde68a",
    text: "#b45309",
    label: "Nhắc nhở",
  },
  danger: {
    bg: "#fef2f2",
    border: "#fecaca",
    text: "#b91c1c",
    label: "Cần xử lý",
  },
  info: {
    bg: "#eff6ff",
    border: "#bfdbfe",
    text: "#1d4ed8",
    label: "Thông báo",
  },
};

export interface BrandedEmail {
  /** Tiêu đề lớn trong thân email. */
  heading: string;
  /** Dòng xem trước hiện trong hộp thư (ẩn trong thân email). */
  preheader: string;
  tone: EmailTone;
  /** Nhãn nhỏ phía trên tiêu đề, mặc định theo tone. */
  badge?: string;
  greeting?: string;
  paragraphs: string[];
  details?: { label: string; value: string }[];
  /** Khung nhấn mạnh, ví dụ nhận xét của Ban Giám hiệu (giữ xuống dòng). */
  highlight?: { title: string; body: string };
  /** Danh sách gạch đầu dòng, ví dụ các khối chưa tạo thực đơn. */
  bullets?: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

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

/** Logo công khai (link ảnh https) nếu có cấu hình; không có thì dùng biểu tượng chữ. */
export function readEmailLogoUrl(
  source: NodeJS.ProcessEnv = process.env,
): string | null {
  const url = safeUrl(source.EMAIL_LOGO_URL?.trim());
  return url && url.startsWith("https://") ? url : null;
}

export function renderBrandedEmail(
  email: BrandedEmail,
  options: { logoUrl?: string | null; year?: number } = {},
): { html: string; text: string } {
  const tone = TONES[email.tone];
  const badge = email.badge ?? tone.label;
  const year = options.year ?? new Date().getFullYear();
  const actionUrl = safeUrl(email.action?.url);
  const logo = options.logoUrl
    ? `<img src="${escapeHtml(options.logoUrl)}" width="40" height="40" alt="${BRAND.name}" style="display:block;width:40px;height:40px;border-radius:10px;border:0;" />`
    : `<div style="width:40px;height:40px;line-height:40px;border-radius:10px;background:#ffffff;color:${BRAND.primary};font-size:22px;text-align:center;font-weight:700;">&#127807;</div>`;

  const detailsHtml = email.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid ${BRAND.border};border-radius:10px;border-collapse:separate;overflow:hidden;">
        ${email.details
          .map(
            (row, index) => `<tr>
              <td style="padding:10px 14px;background:${BRAND.page};color:${BRAND.muted};font-size:13px;width:38%;${index ? `border-top:1px solid ${BRAND.border};` : ""}">${escapeHtml(row.label)}</td>
              <td style="padding:10px 14px;color:${BRAND.text};font-size:14px;font-weight:600;${index ? `border-top:1px solid ${BRAND.border};` : ""}">${multiline(row.value)}</td>
            </tr>`,
          )
          .join("")}
      </table>`
    : "";

  const highlightHtml = email.highlight
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
        <tr><td style="padding:14px 16px;background:${tone.bg};border:1px solid ${tone.border};border-left:4px solid ${tone.text};border-radius:8px;">
          <div style="font-size:12px;font-weight:700;color:${tone.text};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">${escapeHtml(email.highlight.title)}</div>
          <div style="font-size:14px;line-height:1.6;color:${BRAND.text};">${multiline(email.highlight.body)}</div>
        </td></tr>
      </table>`
    : "";

  const bulletsHtml = email.bullets?.length
    ? `<ul style="margin:12px 0 20px;padding-left:20px;color:${BRAND.text};font-size:14px;line-height:1.7;">
        ${email.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>`
    : "";

  const actionHtml =
    actionUrl && email.action
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
        <tr><td style="border-radius:8px;background:${BRAND.primary};">
          <a href="${escapeHtml(actionUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(email.action.label)} &rarr;</a>
        </td></tr>
      </table>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(email.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(email.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td style="background:${BRAND.primary};background-image:linear-gradient(135deg,${BRAND.primary},${BRAND.primaryDark});border-radius:14px 14px 0 0;padding:20px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">${logo}</td>
            <td style="vertical-align:middle;padding-left:12px;">
              <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">${BRAND.name}</div>
              <div style="font-size:12px;color:#d1fae5;">${BRAND.tagline}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#ffffff;padding:28px 28px 24px;border:1px solid ${BRAND.border};border-top:0;border-radius:0 0 14px 14px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${tone.bg};border:1px solid ${tone.border};color:${tone.text};font-size:12px;font-weight:700;">${escapeHtml(badge)}</span>
          <h1 style="margin:14px 0 8px;font-size:22px;line-height:1.3;color:${BRAND.text};">${escapeHtml(email.heading)}</h1>
          ${email.greeting ? `<p style="margin:16px 0 8px;font-size:14px;line-height:1.6;">${escapeHtml(email.greeting)}</p>` : ""}
          ${email.paragraphs.map((p) => `<p style="margin:8px 0;font-size:14px;line-height:1.6;color:#334155;">${multiline(p)}</p>`).join("")}
          ${detailsHtml}
          ${highlightHtml}
          ${bulletsHtml}
          ${actionHtml}
          ${email.footnote ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">${multiline(email.footnote)}</p>` : ""}
        </td></tr>
        <tr><td style="padding:18px 8px;text-align:center;font-size:12px;line-height:1.6;color:${BRAND.muted};">
          Email tự động từ hệ thống <strong style="color:${BRAND.primary};">${BRAND.name}</strong>, vui lòng không trả lời email này.<br />
          &copy; ${year} ${BRAND.name} · ${BRAND.tagline}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `${BRAND.name} – ${email.heading}`,
    "",
    ...(email.greeting ? [email.greeting, ""] : []),
    ...email.paragraphs,
    ...(email.details?.length
      ? ["", ...email.details.map((row) => `${row.label}: ${row.value}`)]
      : []),
    ...(email.highlight
      ? ["", `${email.highlight.title}:`, email.highlight.body]
      : []),
    ...(email.bullets?.length
      ? ["", ...email.bullets.map((item) => `- ${item}`)]
      : []),
    ...(actionUrl && email.action
      ? ["", `${email.action.label}: ${actionUrl}`]
      : []),
    ...(email.footnote ? ["", email.footnote] : []),
    "",
    `Email tự động từ hệ thống ${BRAND.name}, vui lòng không trả lời.`,
  ].join("\n");

  return { html, text };
}
