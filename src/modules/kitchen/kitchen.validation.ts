import { z } from "zod";
import { calendarDate } from "../../utils/auth-validation";
import { paginationSchema } from "../../utils/directory-validation";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

const calendarDateSchema = z
  .string({ error: "Ngày phải có định dạng YYYY-MM-DD" })
  .transform((value, context) => {
    try {
      return calendarDate(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Ngày phải có định dạng YYYY-MM-DD và tồn tại trên lịch",
      });
      return z.NEVER;
    }
  });
const mealTypeSchema = z.enum(["LUNCH", "AFTERNOON"], {
  error: "Ca ăn không hợp lệ",
});
export const kitchenListQuerySchema = paginationSchema;
export const kitchenPlanSchema = z.strictObject({
  menuDayId: requestUuidSchema,
  dishId: requestUuidSchema,
  mealType: mealTypeSchema,
});
export const kitchenActionSchema = z.strictObject({});
export const kitchenCompleteSchema = z
  .strictObject({
    note: z
      .string({ error: "Ghi chú phải là văn bản" })
      .max(2000, { error: "Ghi chú tối đa 2000 ký tự" })
      .nullish(),
    inspectionData: z.record(z.string(), z.json()).optional(),
    preparedPortions: z
      .number({ error: "Số suất phải là số nguyên dương" })
      .int({ error: "Số suất phải là số nguyên dương" })
      .positive({ error: "Số suất phải là số nguyên dương" })
      .max(2147483647, { error: "Số suất vượt giới hạn cho phép" })
      .optional(),
  })
  .transform((body) => ({ note: body.note?.trim() || undefined }))
  .nullish()
  .transform((body) => body ?? undefined);
export const kitchenFiltersSchema = paginationSchema
  .safeExtend({
    date: calendarDateSchema.optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
    mealType: mealTypeSchema.optional(),
    status: z
      .enum(["UNCONFIRMED", "CONFIRMED", "COMPLETED"], {
        error: "Trạng thái mẻ không hợp lệ",
      })
      .optional(),
    menuDayId: requestUuidSchema.optional(),
    dishId: requestUuidSchema.optional(),
    cookingModeApplied: z
      .enum(["COMBINE_LOTS", "SEPARATE_BY_LOT"], {
        error: "Phương thức chế biến không hợp lệ",
      })
      .optional(),
    search: z
      .string({ error: "Từ khóa phải là văn bản" })
      .trim()
      .max(100, { error: "Từ khóa tìm kiếm tối đa 100 ký tự" })
      .transform((value) => value || undefined)
      .optional(),
    hasSample: z
      .enum(["true", "false"], { error: "hasSample phải là true hoặc false" })
      .transform((value) => value === "true")
      .optional(),
  })
  .superRefine((query, context) => {
    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Ngày kết thúc không được trước ngày bắt đầu",
      });
    }
  })
  .transform((query) => ({
    page: query.page,
    limit: query.limit,
    date: query.date,
    startDate: query.startDate,
    endDate: query.endDate,
    mealType: query.mealType,
    status: query.status,
    menuDayId: query.menuDayId,
    dishId: query.dishId,
    cookingModeApplied: query.cookingModeApplied,
    search: query.search,
    hasSample: query.hasSample,
  }));
export const validateKitchenListQuery = (value: unknown) =>
  parseRequest(kitchenListQuerySchema, value);
export const validateKitchenPlan = (value: unknown) =>
  parseRequest(kitchenPlanSchema, value);
export const validateKitchenAction = (value: unknown) => {
  parseRequest(kitchenActionSchema, value ?? {});
};
export const validateKitchenComplete = (value: unknown) =>
  parseRequest(kitchenCompleteSchema, value);
export const validateKitchenFilters = (value: unknown) =>
  parseRequest(kitchenFiltersSchema, value);
export type KitchenFilters = z.infer<typeof kitchenFiltersSchema>;
export type KitchenCompleteInput = z.infer<typeof kitchenCompleteSchema>;
export type KitchenInspection = KitchenCompleteInput;
