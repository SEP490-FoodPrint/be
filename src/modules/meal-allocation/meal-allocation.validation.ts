import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

export const allocationQuerySchema = z.strictObject({
  mealType: z.enum(["LUNCH", "AFTERNOON"]).optional(),
});
export const confirmDistributionSchema = z.strictObject({
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Phiên bản phân bổ không hợp lệ"),
});
export const allocationApplySchema = z.strictObject({
  ...confirmDistributionSchema.shape,
  ...allocationQuerySchema.shape,
  batches: z.array(
    z.strictObject({
      cookingBatchId: requestUuidSchema,
      dishId: requestUuidSchema.optional(),
      entries: z.array(
        z.strictObject({
          dailyMealPortionId: requestUuidSchema,
          allocatedPortions: z
            .union([z.string(), z.number()])
            .transform(String)
            .refine(
              (value) =>
                /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) &&
                Number(value) > 0 &&
                Number(value) <= 2147483647,
              "Số suất phải dương, tối đa hai chữ số thập phân",
            )
            .transform(Number),
        }),
      ),
    }),
  ),
});

export const validateAllocationQuery = (value: unknown) =>
  parseRequest(allocationQuerySchema, value);
export const validateAllocationApply = (value: unknown) =>
  parseRequest(allocationApplySchema, value);
export const validateConfirmDistribution = (value: unknown) =>
  parseRequest(confirmDistributionSchema, value);

export const materialPlanSchema = z.strictObject({
  mealType: z.enum(["LUNCH", "AFTERNOON"]),
  priorityClassIds: z.array(requestUuidSchema).max(1000).default([]),
});
export const materialApplySchema = materialPlanSchema.extend({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  planId: z.string().regex(/^[a-f0-9]{64}$/),
});
export const validateMaterialPlan = (value: unknown) =>
  parseRequest(materialPlanSchema, value);
export const validateMaterialApply = (value: unknown) =>
  parseRequest(materialApplySchema, value);
