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
});
export const validateDeliveryInspectionQuery = (value: unknown) =>
  parseRequest(deliveryInspectionQuerySchema, value);
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
