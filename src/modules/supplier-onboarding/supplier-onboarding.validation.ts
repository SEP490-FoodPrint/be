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

const handlingTypeSchema = z.enum(["DRY_STOCK", "DIRECT_USE"], {
  error: "Chọn loại nguyên liệu: Lưu kho hoặc Dùng ngay",
});
const handlingItemSchema = z.strictObject({
  ingredientId: requestUuidSchema,
  handlingType: handlingTypeSchema,
});
const uniqueIngredients = (
  items: { ingredientId: string }[],
  ctx: z.RefinementCtx,
) => {
  if (new Set(items.map((item) => item.ingredientId)).size !== items.length)
    ctx.addIssue({
      code: "custom",
      message: "Không lặp nguyên liệu",
    });
};
export const contractItemsSchema = z
  .array(handlingItemSchema, { error: "Danh sách nguyên liệu không hợp lệ" })
  .max(200, { error: "Chọn tối đa 200 nguyên liệu" })
  .superRefine(uniqueIngredients);
export const ingredientHandlingParamsSchema = z.strictObject({
  supplierId: requestUuidSchema,
});
export const ingredientHandlingSchema = z.strictObject({
  items: z
    .array(handlingItemSchema, { error: "Danh sách nguyên liệu không hợp lệ" })
    .min(1, { error: "Cần ít nhất 1 nguyên liệu" })
    .max(200, { error: "Tối đa 200 nguyên liệu mỗi lần lưu" })
    .superRefine(uniqueIngredients),
});
export const validateIngredientHandlingParams = (value: unknown) =>
  parseRequest(ingredientHandlingParamsSchema, value);
export const validateIngredientHandlingBody = (value: unknown) =>
  parseRequest(ingredientHandlingSchema, value);

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
    "items",
  ]);
  if (!create && body.supplierId !== undefined)
    throw new HttpError(400, "Không được đổi nhà cung cấp của hồ sơ.");
  const optional = (value: unknown, max: number) =>
    value === undefined || value === null || value === ""
      ? null
      : text(value, max);
  const items = parseRequest(contractItemsSchema, body.items);
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
    items,
    ingredientIds: items.map((item) => item.ingredientId),
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
    orderType: z.enum(["DIRECT_USE", "DRY_STOCK"], {
      error: "Loại đơn không hợp lệ",
    }),
    batchNo: z
      .union([z.literal(1), z.literal(2)], {
        error: "Đợt giao phải là 1 hoặc 2",
      })
      .nullable()
      .optional(),
    note: z.string().max(500).optional(),
    items: z
      .array(orderItemSchema, { error: "Đơn phải có danh sách nguyên liệu" })
      .min(1, { error: "Đơn phải có từ 1 đến 100 dòng nguyên liệu" })
      .max(100, { error: "Đơn phải có từ 1 đến 100 dòng nguyên liệu" }),
  })
  .superRefine((value, ctx) => {
    if (value.orderType === "DIRECT_USE" && value.batchNo == null)
      ctx.addIssue({
        code: "custom",
        path: ["batchNo"],
        message: "Đơn đồ tươi phải chọn Đợt 1 hoặc Đợt 2",
      });
    if (value.orderType === "DRY_STOCK" && value.batchNo != null)
      ctx.addIssue({
        code: "custom",
        path: ["batchNo"],
        message: "Đơn đồ lưu đồ lưu khong có đợt giao",
      });
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
  .transform(({ requestedDeliveryDate, batchNo, ...value }) => ({
    ...value,
    batchNo: value.orderType === "DRY_STOCK" ? null : (batchNo ?? null),
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
