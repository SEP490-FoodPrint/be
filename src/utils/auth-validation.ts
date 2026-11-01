import { HttpError } from "./http-error";
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(400, "ID phải là UUID hợp lệ");
  return value.toLowerCase();
}

export function calendarDate(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(400, "Ngày phải có định dạng YYYY-MM-DD");
  const date = new Date(value + "T00:00:00.000Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, "Ngày không hợp lệ");
  return date;
}

export function isoTimestamp(value: unknown): Date {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    throw new HttpError(400, "Thời gian phải là ISO 8601 có múi giờ");
  calendarDate(value.slice(0, 10));
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new HttpError(400, "Thời gian không hợp lệ");
  return date;
}
export function objectBody(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new HttpError(400, "Nội dung yêu cầu không hợp lệ");
  return value as Record<string, unknown>;
}
export function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw new HttpError(400, "Trường văn bản không hợp lệ");
  return value.trim();
}
