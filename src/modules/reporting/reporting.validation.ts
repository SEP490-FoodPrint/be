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
export const reportingListQuerySchema = z
  .strictObject({
    page: positiveInteger(1),
    limit: positiveInteger(20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
  })
  .refine((value) => (value.page - 1) * value.limit <= 2147483647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  });
export const reportingReceiveParamsSchema = z.strictObject({
  id: requestUuidSchema,
});
export const reportingEmptySchema = z.strictObject({});
export const validateReportingListQuery = (value: unknown) =>
  parseRequest(reportingListQuerySchema, value);
export const validateReportingReceiveParams = (value: unknown) =>
  parseRequest(reportingReceiveParamsSchema, value);
export const validateReportingReceiveBody = (value: unknown) =>
  parseRequest(reportingEmptySchema, value === undefined ? {} : value);
export const validateReportingReceiveQuery = (value: unknown) =>
  parseRequest(reportingEmptySchema, value);
