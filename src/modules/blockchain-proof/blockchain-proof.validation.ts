import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

const kind = z.enum(
  ["deliveries", "cooking-batches", "retained-samples", "registrations"],
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

export const validateRecordParams = (value: unknown) =>
  parseRequest(recordParamsSchema, value);
export const validateVersionParams = (value: unknown) =>
  parseRequest(versionParamsSchema, value);
