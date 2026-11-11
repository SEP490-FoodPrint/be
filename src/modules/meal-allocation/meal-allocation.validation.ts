import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

export const allocationQuerySchema = z.strictObject({});
export const allocationApplySchema = z.strictObject({
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Phiên bản phân bổ không hợp lệ"),
  batches: z.array(
    z.strictObject({
      cookingBatchId: requestUuidSchema,
      entries: z.array(
        z.strictObject({
          dailyMealPortionId: requestUuidSchema,
          allocatedPortions: z
            .number({ error: "Số suất phải là số nguyên dương" })
            .int({ error: "Số suất phải là số nguyên dương" })
            .min(1, { error: "Số suất phải lớn hơn 0" })
            .max(2147483647, { error: "Số suất vượt giới hạn" }),
        }),
      ),
    }),
  ),
});

export const validateAllocationQuery = (value: unknown) =>
  parseRequest(allocationQuerySchema, value);
export const validateAllocationApply = (value: unknown) =>
  parseRequest(allocationApplySchema, value);
