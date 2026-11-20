// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateDeliveryListQuery } from "../../utils/list-query";

import { z } from "zod";
import { DeliveryStatus } from "../../generated/prisma/enums";
import {
  paginationSchema,
  idParamsSchema,
} from "../../utils/directory-validation";
import { parseRequest } from "../../utils/request-validation";

export const deliveryInspectionQuerySchema = paginationSchema.safeExtend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(DeliveryStatus).optional(),
  period: z.enum(["ALL", "today", "week"]).default("ALL"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  orderType: z
    .enum(["DIRECT_USE", "DRY_STOCK"], { error: "Loại đơn không hợp lệ" })
    .optional(),
  batchNo: z
    .string({ error: "Đợt giao phải là 1 hoặc 2" })
    .regex(/^[12]$/, { error: "Đợt giao phải là 1 hoặc 2" })
    .transform((v) => Number(v) as 1 | 2)
    .optional(),
});
export const validateDeliveryInspectionQuery = (value: unknown) =>
  parseRequest(deliveryInspectionQuerySchema, value);
// Nội dung quét được từ tem QR (link truy xuất), mã QR lô hoặc mã đợt giao nhập tay.
export const deliveryInspectionLookupSchema = z.strictObject({
  code: z
    .string({ error: "Cần mã QR hoặc mã đợt giao" })
    .trim()
    .min(1, { error: "Cần mã QR hoặc mã đợt giao" })
    .max(2048, { error: "Mã QR quá dài" }),
});
export const validateDeliveryInspectionLookup = (value: unknown) =>
  parseRequest(deliveryInspectionLookupSchema, value);
export const validateDeliveryId = (value: unknown) =>
  parseRequest(idParamsSchema, value);

export const deliveryInspectionDecisionSchema = z
  .strictObject({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((value) => value || null),
  })
  .superRefine((value, context) => {
    if (value.decision === "REJECT" && !value.reason)
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Cần ghi rõ lý do từ chối nguyên liệu",
      });
  });
export const validateDeliveryInspectionDecision = (value: unknown) =>
  parseRequest(deliveryInspectionDecisionSchema, value);

export const deliveryArrivalBodySchema = z.strictObject({});
export const deliveryArrivalQuerySchema = z.strictObject({});

export const validateDeliveryArrivalBody = (value: unknown) =>
  parseRequest(deliveryArrivalBodySchema, value === undefined ? {} : value);
export const validateDeliveryArrivalQuery = (value: unknown) =>
  parseRequest(deliveryArrivalQuerySchema, value);
