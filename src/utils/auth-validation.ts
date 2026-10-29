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
