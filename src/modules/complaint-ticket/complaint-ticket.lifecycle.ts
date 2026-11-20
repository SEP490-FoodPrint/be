import { HttpError } from "../../utils/http-error";

/**
 * Quy tắc thuần của luồng ticket khiếu nại (specs/complaint-supertype, FR-004/FR-009).
 * Không truy vấn DB; service của từng loại đơn dùng để quyết định thao tác và hiển thị.
 */
export const TICKET_STATUSES = [
  "NEW",
  "IN_PROGRESS",
  "REOPENED",
  "RESOLVED",
  "CLOSED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type TicketAction =
  "ACCEPT" | "COMMENT" | "RESOLVE" | "SATISFY" | "REOPEN";

/** Người xem đơn: người gửi, bên xử lý, hay chỉ được xem (ví dụ System Admin, BGH không có quyền xử lý). */
export type TicketViewer = "REQUESTER" | "HANDLER" | "OBSERVER";

export type RequesterDisplayStatus = "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type TicketDisplayStatus = TicketStatus | RequesterDisplayStatus;

/** Người gửi có 48h kể từ lần "Đã xử lý" gần nhất để Hài lòng / Yêu cầu xử lý lại. */
export const FEEDBACK_WINDOW_MS = 48 * 60 * 60 * 1000;

export const TICKET_CONTENT_MAX_LENGTH = 5000;

export interface TicketState {
  status: TicketStatus;
  lastResolvedAt: Date | null;
}

export function feedbackDeadline(state: TicketState): Date | null {
  if (state.status !== "RESOLVED" || !state.lastResolvedAt) return null;
  return new Date(state.lastResolvedAt.getTime() + FEEDBACK_WINDOW_MS);
}

/** Mốc dùng trong điều kiện cập nhật: đơn còn hạn ⇔ `lastResolvedAt > now − 48h`. */
export function feedbackWindowStart(now: Date): Date {
  return new Date(now.getTime() - FEEDBACK_WINDOW_MS);
}

export function isWithinFeedbackWindow(state: TicketState, now: Date): boolean {
  const deadline = feedbackDeadline(state);
  return deadline !== null && now.getTime() < deadline.getTime();
}

const REQUESTER_COMMENT_STATUSES: readonly TicketStatus[] = [
  "NEW",
  "IN_PROGRESS",
  "REOPENED",
];

export function allowedTicketActions(
  viewer: TicketViewer,
  state: TicketState,
  now: Date,
): TicketAction[] {
  if (viewer === "REQUESTER") {
    if (REQUESTER_COMMENT_STATUSES.includes(state.status)) return ["COMMENT"];
    if (isWithinFeedbackWindow(state, now)) return ["SATISFY", "REOPEN"];
    return [];
  }
  if (viewer === "HANDLER") {
    if (state.status === "NEW" || state.status === "REOPENED")
      return ["ACCEPT"];
    if (state.status === "IN_PROGRESS") return ["COMMENT", "RESOLVE"];
  }
  return [];
}

const CONFLICT_MESSAGES: Record<TicketAction, string> = {
  ACCEPT: "Chỉ tiếp nhận được đơn mới hoặc đơn được yêu cầu xử lý lại",
  COMMENT: "Trạng thái đơn hiện tại không cho phép bình luận",
  RESOLVE: "Chỉ báo đã xử lý được khi đơn đang xử lý",
  SATISFY: "Chỉ đánh giá được trong 48 giờ sau khi đơn được báo đã xử lý",
  REOPEN:
    "Chỉ yêu cầu xử lý lại được trong 48 giờ sau khi đơn được báo đã xử lý",
};

export function ticketConflictMessage(action: TicketAction): string {
  return CONFLICT_MESSAGES[action];
}

/** Ném 409 nếu người xem không được thực hiện thao tác ở trạng thái hiện tại. */
export function assertTicketAction(
  viewer: TicketViewer,
  state: TicketState,
  action: TicketAction,
  now: Date,
): void {
  if (!allowedTicketActions(viewer, state, now).includes(action))
    throw new HttpError(409, CONFLICT_MESSAGES[action]);
}

/** Trạng thái đích của thao tác đổi trạng thái (COMMENT giữ nguyên trạng thái). */
export const TICKET_TRANSITIONS = {
  ACCEPT: { to: "IN_PROGRESS" },
  RESOLVE: { to: "RESOLVED" },
  SATISFY: { to: "CLOSED", closeReason: "SATISFIED" },
  REOPEN: { to: "REOPENED" },
} as const satisfies Record<
  Exclude<TicketAction, "COMMENT">,
  { to: TicketStatus; closeReason?: string }
>;

export function displayStatus(
  viewer: TicketViewer,
  status: TicketStatus,
): TicketDisplayStatus {
  if (viewer !== "REQUESTER") return status;
  if (status === "RESOLVED" || status === "CLOSED") return status;
  return "IN_PROGRESS";
}

/** Nhãn "Có tin nhắn mới" cho bên xử lý: đơn đang xử lý và bình luận cuối là của người gửi. */
export function hasNewMessage(
  viewer: TicketViewer,
  status: TicketStatus,
  lastCommentSide: "REQUESTER" | "HANDLER" | null,
): boolean {
  return (
    viewer !== "REQUESTER" &&
    status === "IN_PROGRESS" &&
    lastCommentSide === "REQUESTER"
  );
}

export function toTicketStatus(value: string): TicketStatus {
  if ((TICKET_STATUSES as readonly string[]).includes(value))
    return value as TicketStatus;
  throw new HttpError(503, "Không thể tải dữ liệu. Vui lòng thử lại sau.");
}

const VIETNAM_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Tiêu đề tự sinh cho khiếu nại suất ăn; `mealDate` là ngày (DATE) lưu ở 00:00 UTC. */
export function mealComplaintTitle(input: {
  className: string;
  mealType: string;
  mealDate: Date;
}): string {
  const meal =
    input.mealType === "AFTERNOON"
      ? "Bữa chiều"
      : input.mealType === "LUNCH"
        ? "Bữa trưa"
        : "Bữa ăn";
  return truncateTitle(
    `Khiếu nại suất ăn lớp ${input.className} - ${meal} ngày ${VIETNAM_DATE.format(input.mealDate)}`,
  );
}

/** Tiêu đề tự sinh cho phản ánh chất lượng nguyên liệu theo chuyến giao. */
export function ingredientFeedbackTitle(deliveryNo: string): string {
  return truncateTitle(
    `Phản ánh chất lượng nguyên liệu chuyến giao ${deliveryNo}`,
  );
}

function truncateTitle(value: string): string {
  const chars = Array.from(value);
  return chars.length <= 255 ? value : chars.slice(0, 255).join("");
}
