import { z } from "zod";
import { TICKET_CONTENT_MAX_LENGTH } from "./complaint-ticket.lifecycle";

function ticketText(label: string) {
  return z
    .string({ error: `${label} phải là văn bản` })
    .transform((value) => value.trim())
    .refine((value) => Array.from(value).length >= 1, {
      error: `${label} không được để trống`,
    })
    .refine((value) => Array.from(value).length <= TICKET_CONTENT_MAX_LENGTH, {
      error: `${label} chỉ nhận tối đa ${TICKET_CONTENT_MAX_LENGTH} ký tự`,
    });
}

/** Body bình luận hai chiều. */
export const ticketCommentBodySchema = z.strictObject({
  content: ticketText("Nội dung bình luận"),
});

/** Body "Đã xử lý": nội dung xử lý bắt buộc. */
export const ticketResolveBodySchema = z.strictObject({
  content: ticketText("Nội dung xử lý"),
});

/** Body "Yêu cầu xử lý lại": lý do tùy chọn. */
export const ticketReopenBodySchema = z.strictObject({
  reason: ticketText("Lý do yêu cầu xử lý lại").optional(),
});

/** Thao tác không có body (Tiếp nhận, Hài lòng). */
export const ticketEmptyBodySchema = z.strictObject({});
