import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

const positiveInteger = (fallback: number) =>
  z
    .string({ error: "Phải là số nguyên dương" })
    .regex(/^[1-9]\d*$/, { error: "Phải là số nguyên dương" })
    .transform(Number)
    .refine(Number.isSafeInteger, { error: "Số vượt giới hạn cho phép" })
    .default(fallback);
export const supplyOrderListQuerySchema = z
  .strictObject({
    page: positiveInteger(1),
    limit: positiveInteger(20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
    status: z
      .enum(["SENT", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], {
        error: "Trạng thái yêu cầu không hợp lệ",
      })
      .optional(),
  })
  .refine((value) => (value.page - 1) * value.limit <= 2147483647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  });
export const supplyOrderAcceptParamsSchema = z.strictObject({
  id: requestUuidSchema,
});
export const supplyOrderDetailParamsSchema = supplyOrderAcceptParamsSchema;
export const supplyOrderEmptySchema = z.strictObject({});
export const validateSupplyOrderListQuery = (value: unknown) =>
  parseRequest(supplyOrderListQuerySchema, value);
export const validateSupplyOrderAcceptParams = (value: unknown) =>
  parseRequest(supplyOrderAcceptParamsSchema, value);
export const validateSupplyOrderAcceptBody = (value: unknown) =>
  parseRequest(supplyOrderEmptySchema, value === undefined ? {} : value);
export const validateSupplyOrderAcceptQuery = (value: unknown) =>
  parseRequest(supplyOrderEmptySchema, value);
export const validateSupplyOrderDetailParams = (value: unknown) =>
  parseRequest(supplyOrderDetailParamsSchema, value);
export const validateSupplyOrderDetailQuery = (value: unknown) =>
  parseRequest(supplyOrderEmptySchema, value);
