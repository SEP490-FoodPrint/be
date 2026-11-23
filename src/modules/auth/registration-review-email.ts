import {
  readEmailAppUrl,
  readEmailLogoUrl,
  renderLetterEmail,
  type LetterEmail,
} from "../../utils/branded-email";
import type { ReviewRow } from "./registration-review";
import type { Application } from "./onboarding.repository";

function organizationName(profileData: unknown): string | null {
  return profileData &&
    typeof profileData === "object" &&
    !Array.isArray(profileData) &&
    "name" in profileData &&
    typeof profileData.name === "string" &&
    profileData.name.trim()
    ? profileData.name
    : null;
}

function render(email: LetterEmail) {
  return renderLetterEmail(email, { logoUrl: readEmailLogoUrl() });
}

/** Nút "Đăng nhập ngay", chỉ khi có cấu hình origin giao diện. */
function loginAction() {
  const url = readEmailAppUrl();
  return url ? { action: { label: "Đăng nhập ngay", url } } : {};
}

function dossierFields(code: string, profileData: unknown) {
  return [
    { label: "Mã hồ sơ", value: code },
    {
      label: "Tổ chức",
      value: organizationName(profileData) ?? "Hồ sơ đăng ký tài khoản",
    },
  ];
}

export function reviewEmail(row: ReviewRow, rejectionReason?: string) {
  const registrationID = row.code;
  const subject = rejectionReason
    ? `[FoodPrint] Hồ sơ ${registrationID} chưa được phê duyệt`
    : `[FoodPrint] Hồ sơ ${registrationID} đã được phê duyệt`;
  const common = {
    title: subject,
    greeting: `Kính gửi ${row.applicantUser.fullName},`,
  };
  const content: LetterEmail = rejectionReason
    ? {
        ...common,
        preheader: `Hồ sơ ${registrationID} đã bị từ chối. Vui lòng sửa và nộp lại.`,
        intro: ["Hồ sơ đăng ký tài khoản của bạn chưa được phê duyệt:"],
        fields: [
          ...dossierFields(registrationID, row.profileData),
          { label: "Lý do từ chối", value: rejectionReason, block: true },
        ],
        outro: ["Vui lòng đăng nhập FoodPrint, sửa hồ sơ và nộp lại."],
        ...loginAction(),
      }
    : {
        ...common,
        preheader: `Hồ sơ ${registrationID} đã được phê duyệt. Tài khoản đã được kích hoạt.`,
        intro: ["Hồ sơ đăng ký tài khoản của bạn đã được phê duyệt:"],
        fields: dossierFields(registrationID, row.profileData),
        outro: [
          "Tài khoản của bạn đã được kích hoạt, bạn có thể đăng nhập FoodPrint ngay.",
        ],
        ...loginAction(),
      };
  return {
    recipientEmail: row.applicantUser.email,
    subject,
    ...render(content),
  };
}

export function submissionEmail(
  row: Application,
  recipient: { fullName: string; email: string },
) {
  const registrationID = row.code;
  const subject = `[FoodPrint] Đã tiếp nhận hồ sơ ${registrationID}`;
  return {
    recipientEmail: recipient.email,
    subject,
    ...render({
      title: subject,
      preheader: `FoodPrint đã tiếp nhận hồ sơ ${registrationID}.`,
      greeting: `Kính gửi ${recipient.fullName},`,
      intro: ["Chúng tôi đã tiếp nhận hồ sơ đăng ký tài khoản của bạn:"],
      fields: dossierFields(registrationID, row.profileData),
      outro: [
        "Hồ sơ đang chờ xét duyệt, chúng tôi sẽ gửi email khi có kết quả.",
      ],
    }),
  };
}
