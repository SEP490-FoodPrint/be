import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

export const lifecycleParamsSchema = z.strictObject({
  userId: requestUuidSchema,
});
export const lifecycleEmptySchema = z.strictObject({});
export const intakeStateSchema = z.strictObject({
  state: z.enum(["ACTIVE", "PAUSED", "PAUSED_FOR_FOOD_SAFETY_INSPECTION"], {
    error: "Trạng thái tạm dừng không hợp lệ",
  }),
});
export const validateLifecycleParams = (value: unknown) =>
  parseRequest(lifecycleParamsSchema, value);
export const validateLifecycleQuery = (value: unknown) =>
  parseRequest(lifecycleEmptySchema, value);
export const validateLifecycleAction = (value: unknown) =>
  parseRequest(lifecycleEmptySchema, value === undefined ? {} : value);
export const validateIntakeState = (value: unknown) =>
  parseRequest(intakeStateSchema, value);
