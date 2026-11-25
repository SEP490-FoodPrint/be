import { z } from "zod";
import { evidenceFilesSchema } from "../../utils/evidence-files";
import { TICKET_CONTENT_MAX_LENGTH } from "./complaint-ticket.lifecycle";

export { evidenceFilesSchema };

/** Tiêu đề do người gửi nhập (plan v6 Q33): 5–255 ký tự sau trim. */
export const ticketTitleSchema = z
  .string({ error: "Tiêu đề phải là văn bản" })
  .transform((value) => value.trim())
  .refine((value) => Array.from(value).length >= 5, {
    error: "Tiêu đề tối thiểu 5 ký tự",
  })
  .refine((value) => Array.from(value).length <= 255, {
    error: "Tiêu đề chỉ nhận tối đa 255 ký tự",
  });

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

/** Body bình luận hai chiều; nội dung vẫn bắt buộc khi có file. */
export const ticketCommentBodySchema = z.strictObject({
  content: ticketText("Nội dung bình luận"),
});

/** Body "Đã xử lý": nội dung xử lý bắt buộc. */
export const ticketResolveBodySchema = z.strictObject({
  content: ticketText("Nội dung xử lý"),
});

/** Bình luận + file đính kèm (multipart): `files` do controller ghép từ `req.files`. */
export const ticketCommentInputSchema = ticketCommentBodySchema.extend({
  files: evidenceFilesSchema,
});

/** "Đã xử lý" + file đính kèm. */
export const ticketResolveInputSchema = ticketResolveBodySchema.extend({
  files: evidenceFilesSchema,
});

/** Body "Yêu cầu xử lý lại": lý do tùy chọn. */
export const ticketReopenBodySchema = z.strictObject({
  reason: ticketText("Lý do yêu cầu xử lý lại").optional(),
});

/** Thao tác không có body (Tiếp nhận, Hài lòng). */
export const ticketEmptyBodySchema = z.strictObject({});
