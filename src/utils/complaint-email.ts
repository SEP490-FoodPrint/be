import { renderLetterEmail, type LetterEmail } from "./branded-email";

/** Sự kiện ticket gửi email cho người gửi đơn (specs/complaint-email-notifications FR-004). */
export type ComplaintEmailEvent = "CREATED" | "HANDLER_COMMENT" | "RESOLVED";
export type ComplaintEmailKind = "MEAL" | "INGREDIENT" | "AUTHORITY" | "SYSTEM";

export interface ComplaintEmailInput {
  event: ComplaintEmailEvent;
  kind: ComplaintEmailKind;
  code: string;
  title: string;
  /** Nội dung người gửi đã nhập khi tạo đơn. */
  description: string;
  recipientName: string;
  /** Bình luận của bên xử lý (HANDLER_COMMENT) hoặc nội dung xử lý (RESOLVED). */
  comment?: { authorName: string; createdAt: Date; content: string } | null;
  /** Liên kết mở FoodPrint (origin giao diện); không có thì bỏ nút. */
  appUrl?: string | null;
}

/** Bên xử lý theo loại đơn, dạng viết giữa câu (đầu câu viết hoa chữ đầu). */
const HANDLER_LABELS: Record<ComplaintEmailKind, string> = {
  MEAL: "Ban Giám hiệu nhà trường",
  INGREDIENT: "nhà cung cấp",
  AUTHORITY: "đơn vị ATTP phường/xã",
  // Không còn đơn SYSTEM (specs/remove-system-complaints); giữ nhãn vì enum DB còn giá trị này.
  SYSTEM: "Quản trị hệ thống FoodPrint",
};

const VIETNAM_DATE_TIME = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hourCycle: "h23",
  timeZone: "Asia/Ho_Chi_Minh",
});

export function formatVietnamDateTime(value: Date): string {
  return VIETNAM_DATE_TIME.format(value);
}

function subjectOf(input: ComplaintEmailInput): string {
  if (input.event === "CREATED")
    return `[FoodPrint] Đã ghi nhận đơn ${input.code}`;
  if (input.event === "HANDLER_COMMENT")
    return `[FoodPrint] Có phản hồi mới cho đơn ${input.code}`;
  return `[FoodPrint] Đơn ${input.code} đã được xử lý`;
}

function contentOf(input: ComplaintEmailInput): LetterEmail {
  const handler = HANDLER_LABELS[input.kind];
  const Handler = handler.charAt(0).toUpperCase() + handler.slice(1);
  const common = {
    greeting: `Kính gửi ${input.recipientName},`,
    title: subjectOf(input),
  };
  const ticketFields = [
    { label: "Mã đơn", value: input.code },
    { label: "Tiêu đề", value: input.title },
  ];
  const action = (label: string) =>
    input.appUrl ? { action: { label, url: input.appUrl } } : {};
  const commentField = (label: string) =>
    input.comment
      ? [
          {
            label: `${label} (${input.comment.authorName} · ${formatVietnamDateTime(input.comment.createdAt)})`,
            value: input.comment.content,
            block: true,
          },
        ]
      : [];

  if (input.event === "CREATED")
    return {
      ...common,
      preheader: `Chúng tôi đã nhận được đơn ${input.code} của bạn.`,
      intro: ["Chúng tôi đã nhận được đơn của bạn với nội dung như sau:"],
      fields: [
        ...ticketFields,
        { label: "Nội dung", value: input.description, block: true },
      ],
      outro: [
        `Đơn đã được chuyển tới ${handler} và sẽ được phản hồi trong thời gian sớm nhất. Toàn bộ trao đổi diễn ra ngay trên trang đơn - nơi bạn có thể xem phản hồi và trả lời lại, tất cả ở một chỗ.`,
      ],
      ...action("Theo dõi & trao đổi tại đây"),
    };

  if (input.event === "HANDLER_COMMENT")
    return {
      ...common,
      preheader: `${Handler} vừa phản hồi đơn ${input.code}.`,
      intro: [`${Handler} vừa phản hồi đơn của bạn:`],
      fields: [...ticketFields, ...commentField("Phản hồi")],
      outro: ["Bạn có thể xem và trả lời ngay trên trang đơn."],
      ...action("Xem & trả lời phản hồi"),
    };

  return {
    ...common,
    preheader: `Đơn ${input.code} đã được xử lý. Đơn sẽ tự đóng sau 48 giờ.`,
    intro: [`${Handler} đã xử lý đơn của bạn với kết quả như sau:`],
    fields: [...ticketFields, ...commentField("Kết quả xử lý")],
    note: "Đơn sẽ tự đóng sau 48 giờ nếu bạn không phản hồi.",
    ...action("Xem kết quả xử lý"),
  };
}

/** Dựng email thông báo khiếu nại (dạng lá thư); mọi giá trị động được escape. */
export function buildComplaintEmail(
  input: ComplaintEmailInput,
  options: { logoUrl?: string | null; year?: number } = {},
): { subject: string; text: string; html: string } {
  const subject = Array.from(subjectOf(input)).slice(0, 255).join("");
  return { subject, ...renderLetterEmail(contentOf(input), options) };
}
