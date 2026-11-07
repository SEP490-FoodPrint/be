import type { ReviewRow } from "./registration-review";
import { formatRegistrationID } from "../../utils/registration-id";
import type { Application } from "./onboarding.repository";

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
  const registrationID = formatRegistrationID(row.registrationNumber);
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
  const text = `Xin chào ${name},\n\nHồ sơ ${registrationID} của ${organization} đã được ${decision}.\n${nextStep}`;
  return {
    recipientEmail: row.applicantUser.email,
    subject: `FoodPrint: Hồ sơ đăng ký đã được ${decision}`,
    text,
    html: `<p>Xin chào ${escapeHtml(name)},</p><p>Hồ sơ ${escapeHtml(registrationID)} của ${escapeHtml(organization)} đã được ${decision}.</p>${rejectionReason ? `<p>Lý do: ${escapeHtml(rejectionReason)}</p><p>Vui lòng đăng nhập FoodPrint, sửa hồ sơ và nộp lại.</p>` : "<p>Tài khoản của bạn đã được kích hoạt. Vui lòng đăng nhập FoodPrint.</p>"}`,
  };
}

export function submissionEmail(
  row: Application,
  recipient: { fullName: string; email: string },
) {
  const registrationID = formatRegistrationID(row.registrationNumber);
  const text = `Xin chào ${recipient.fullName},\n\nFoodPrint đã tiếp nhận hồ sơ ${registrationID} của bạn. Hồ sơ đang chờ xét duyệt.\nChúng tôi sẽ gửi email khi hồ sơ được phê duyệt hoặc từ chối. Bạn có thể đăng nhập FoodPrint để theo dõi hồ sơ.`;
  return {
    recipientEmail: recipient.email,
    subject: "FoodPrint: Đã tiếp nhận hồ sơ đăng ký",
    text,
    html: `<p>Xin chào ${escapeHtml(recipient.fullName)},</p><p>FoodPrint đã tiếp nhận hồ sơ ${escapeHtml(registrationID)} của bạn. Hồ sơ đang chờ xét duyệt.</p><p>Chúng tôi sẽ gửi email khi hồ sơ được phê duyệt hoặc từ chối. Bạn có thể đăng nhập FoodPrint để theo dõi hồ sơ.</p>`,
  };
}
