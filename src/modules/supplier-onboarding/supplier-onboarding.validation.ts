import { z } from "zod";
import {
  parseRequest,
  requiredText,
  requestUuidSchema,
} from "../../utils/request-validation";
import { objectBody, text, uuid } from "../../utils/auth-validation";
import { parseListQuery } from "../../utils/list-query";
import { HttpError } from "../../utils/http-error";

export function listQuery(query: Record<string, unknown>) {
  objectBody(query, [
    "page",
    "limit",
    "q",
    "provinceId",
    "wardId",
    "locationMode",
    "category",
    "status",
  ]);
  const page = parseListQuery({ page: query.page, limit: query.limit });
  const optional = (value: unknown, max: number) =>
    value === undefined || value === "" ? undefined : text(value, max);
  const locationMode = optional(query.locationMode, 20) || "REGISTERED";
  if (!["REGISTERED", "SERVICE"].includes(locationMode))
    throw new HttpError(400, "Bộ lọc địa bàn không hợp lệ.");
  return {
    ...page,
    q: optional(query.q, 120),
    provinceId: query.provinceId ? uuid(query.provinceId) : undefined,
    wardId: query.wardId ? uuid(query.wardId) : undefined,
    category: optional(query.category, 120),
    status: optional(query.status, 30),
    locationMode,
  };
}

function date(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(400, "Ngày phải có định dạng YYYY-MM-DD.");
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, "Ngày không hợp lệ.");
  return result;
}

export function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new HttpError(400, "Phiên bản hồ sơ không hợp lệ.");
  return value;
}

export function contractPayload(value: unknown, create: boolean) {
  const body = objectBody(value, [
    "supplierId",
    "revision",
    "number",
    "signedOn",
    "startsOn",
    "endsOn",
    "scopeNote",
    "certificationId",
    "exemptionNote",
    "ingredientIds",
  ]);
  if (!create && body.supplierId !== undefined)
    throw new HttpError(400, "Không được đổi nhà cung cấp của hồ sơ.");
  const optional = (value: unknown, max: number) =>
    value === undefined || value === null || value === ""
      ? null
      : text(value, max);
  if (!Array.isArray(body.ingredientIds) || body.ingredientIds.length > 200)
    throw new HttpError(400, "Chọn tối đa 200 nguyên liệu.");
  const ingredientIds = [...new Set(body.ingredientIds.map(uuid))];
  const data = {
    number: optional(body.number, 120),
    signedOn: date(body.signedOn),
    startsOn: date(body.startsOn),
    endsOn: date(body.endsOn),
    scopeNote: optional(body.scopeNote, 4000),
    certificationId: body.certificationId ? uuid(body.certificationId) : null,
    exemptionNote: optional(body.exemptionNote, 4000),
  };
  if (data.startsOn && data.endsOn && data.startsOn > data.endsOn)
    throw new HttpError(400, "Ngày kết thúc phải từ ngày bắt đầu trở đi.");
  if (data.certificationId && data.exemptionNote)
    throw new HttpError(
      400,
      "Chọn chứng nhận hoặc hồ sơ áp dụng/miễn cấp, không chọn cả hai.",
    );
  return {
    supplierId: create ? uuid(body.supplierId) : undefined,
    revision: create ? undefined : revision(body.revision),
    ingredientIds,
    data,
  };
}

export function activationPayload(value: unknown) {
  const body = objectBody(value, ["revision", "verified"]);
  if (body.verified !== true)
    throw new HttpError(
      400,
      "Cần xác nhận đã kiểm tra hợp đồng ký và hồ sơ pháp lý/ATTP.",
    );
  return revision(body.revision);
}

export function reasonPayload(value: unknown) {
  return text(objectBody(value, ["reason"]).reason, 4000);
}

const orderDate = z.string({ error: "Cần ngày giao dự kiến" }).refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  },
  { error: "Ngày giao dự kiến không hợp lệ" },
);
const orderItemSchema = z.strictObject({
  ingredientEntryId: requestUuidSchema,
  quantity: z
    .number({ error: "Số lượng phải là số" })
    .finite()
    .positive({ error: "Số lượng phải dương" })
    .max(1e9, { error: "Số lượng vượt giới hạn" })
    .refine(
      (value) => Math.abs(Math.round(value * 1000) - value * 1000) <= 1e-5,
      { error: "Số lượng tối đa 3 chữ số thập phân" },
    ),
});
export const orderDraftSchema = z
  .strictObject({
    supplierId: requestUuidSchema,
    requestNo: requiredText(80),
    requestedDeliveryDate: orderDate,
    items: z
      .array(orderItemSchema, { error: "Đơn phải có danh sách nguyên liệu" })
      .min(1, { error: "Đơn phải có từ 1 đến 100 dòng nguyên liệu" })
      .max(100, { error: "Đơn phải có từ 1 đến 100 dòng nguyên liệu" }),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.items.map((item) => item.ingredientEntryId)).size !==
      value.items.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Không lặp nguyên liệu trong đơn",
      });
    }
  })
  .transform(({ requestedDeliveryDate, ...value }) => ({
    ...value,
    deliveryDate: new Date(`${requestedDeliveryDate}T00:00:00.000Z`),
  }));
export const orderSendParamsSchema = z.strictObject({ id: requestUuidSchema });
export const orderSendSchema = z.strictObject({
  contractId: requestUuidSchema,
});
export const orderPayload = (value: unknown) =>
  parseRequest(orderDraftSchema, value);
export const validateOrderSendParams = (value: unknown) =>
  parseRequest(orderSendParamsSchema, value);
export const validateOrderSendBody = (value: unknown) =>
  parseRequest(orderSendSchema, value);
