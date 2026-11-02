import type { ReviewRow } from "./registration-review";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

export function reviewEmail(row: ReviewRow, rejectionReason?: string) {
  const name = row.applicantUser.fullName;
  const organization =
    row.profileData &&
    typeof row.profileData === "object" &&
    !Array.isArray(row.profileData) &&
    "name" in row.profileData &&
    typeof row.profileData.name === "string"
      ? row.profileData.name
      : "tổ chức đăng ký";
  const decision = rejectionReason ? "từ chối" : "phê duyệt";
  const nextStep = rejectionReason
    ? `Lý do: ${rejectionReason}\nVui lòng đăng nhập FoodPrint, sửa hồ sơ và nộp lại.`
    : "Tài khoản của bạn đã được kích hoạt. Vui lòng đăng nhập FoodPrint.";
  const text = `Xin chào ${name},\n\nHồ sơ ${row.id} của ${organization} đã được ${decision}.\n${nextStep}`;
  return {
    recipientEmail: row.applicantUser.email,
    subject: `FoodPrint: Hồ sơ đăng ký đã được ${decision}`,
    text,
    html: `<p>Xin chào ${escapeHtml(name)},</p><p>Hồ sơ ${escapeHtml(row.id)} của ${escapeHtml(organization)} đã được ${decision}.</p>${rejectionReason ? `<p>Lý do: ${escapeHtml(rejectionReason)}</p><p>Vui lòng đăng nhập FoodPrint, sửa hồ sơ và nộp lại.</p>` : "<p>Tài khoản của bạn đã được kích hoạt. Vui lòng đăng nhập FoodPrint.</p>"}`,
  };
}
