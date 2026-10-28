import { HttpError } from "../../utils/http-error";

export { parseListQuery as validateMenuListQuery } from "../../utils/list-query";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateMenuId(value: string): string {
  if (!uuidPattern.test(value)) {
    throw new HttpError(400, "Mã thực đơn không hợp lệ");
  }
  return value;
}

export function validateApprovalPayload(body: unknown): { notes?: string } {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Dữ liệu phê duyệt không hợp lệ");
  }
  const notes = (body as { notes?: unknown }).notes;
  if (notes !== undefined && typeof notes !== "string") {
    throw new HttpError(400, "Ý kiến phê duyệt phải là chuỗi");
  }
  if (typeof notes === "string" && notes.length > 2000) {
    throw new HttpError(400, "Ý kiến không được vượt quá 2000 ký tự");
  }
  return notes?.trim() ? { notes: notes.trim() } : {};
}

export function validateRevisionPayload(body: unknown): { reason: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Dữ liệu yêu cầu chỉnh sửa không hợp lệ");
  }
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason !== "string" || !reason.trim()) {
    throw new HttpError(400, "Lý do yêu cầu chỉnh sửa là bắt buộc");
  }
  if (reason.trim().length > 2000) {
    throw new HttpError(400, "Lý do không được vượt quá 2000 ký tự");
  }
  return { reason: reason.trim() };
}
