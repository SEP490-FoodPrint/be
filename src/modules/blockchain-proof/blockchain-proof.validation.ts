import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

const kind = z.enum(
  [
    "deliveries",
    "delivery-declarations",
    "cooking-batches",
    "retained-samples",
    "registrations",
    "meal-distributions",
  ],
  { error: "Loại bằng chứng không hợp lệ" },
);

export const recordParamsSchema = z.strictObject({
  kind,
  recordId: requestUuidSchema,
});
export const versionParamsSchema = z.strictObject({
  kind,
  versionId: requestUuidSchema,
});
export const chainParamsSchema = z.strictObject({
  mealAllocationId: requestUuidSchema,
});
export const chainQuerySchema = z.strictObject({
  verify: z
    .enum(["true", "false"], { error: "verify phải là true hoặc false" })
    .optional()
    .transform((value) => value === "true"),
});

export const validateRecordParams = (value: unknown) =>
  parseRequest(recordParamsSchema, value);
export const validateVersionParams = (value: unknown) =>
  parseRequest(versionParamsSchema, value);
export const validateChainParams = (value: unknown) =>
  parseRequest(chainParamsSchema, value);
export const validateChainQuery = (value: unknown) =>
  parseRequest(chainQuerySchema, value);
