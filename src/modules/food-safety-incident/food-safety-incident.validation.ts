import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

export const FOOD_SAFETY_INCIDENT_STATUSES = [
  "PENDING_SCHOOL_REVIEW",
  "SUBMITTED_TO_AUTHORITY",
  "AUTHORITY_ACKNOWLEDGED",
  "UNDER_INSPECTION",
  "INSPECTION_COMPLETED",
  "CLOSED",
  "CANCELLED_BY_SCHOOL",
] as const;
export const PRELIMINARY_ASSESSMENTS = [
  "SCHOOL_MEAL_SUSPECTED",
  "OUTSIDE_MEAL",
  "UNDETERMINED",
] as const;
export const CANCELLATION_REASONS = [
  "DUPLICATE_REPORT",
  "DATA_ENTRY_ERROR",
] as const;

const optionalText = (maximum: number) =>
  z
    .string({ error: "Trường phải là văn bản" })
    .trim()
    .max(maximum, { error: `Trường chỉ nhận tối đa ${maximum} ký tự` })
    .transform((value) => (value ? value : undefined))
    .optional();

export const foodSafetyIncidentListQuerySchema = z.strictObject({
  page: z.coerce
    .number({ error: "page phải là số nguyên dương" })
    .int({ error: "page phải là số nguyên dương" })
    .positive({ error: "page phải là số nguyên dương" })
    .max(1_000_000, { error: "page vượt giới hạn phân trang" })
    .default(1),
  limit: z.coerce
    .number({ error: "limit phải là số nguyên dương" })
    .int({ error: "limit phải là số nguyên dương" })
    .min(1, { error: "limit phải là số nguyên dương" })
    .max(100, { error: "limit tối đa 100" })
    .default(20),
  status: z
    .enum(FOOD_SAFETY_INCIDENT_STATUSES, {
      error: "Trạng thái sự cố không hợp lệ",
    })
    .optional(),
});

export const foodSafetyIncidentParamsSchema = z.strictObject({
  id: requestUuidSchema,
});

/** PR5b: `GET /:id/trace-snapshots/:version`. */
export const foodSafetyIncidentSnapshotParamsSchema = z.strictObject({
  id: requestUuidSchema,
  version: z.coerce
    .number({ error: "version phải là số nguyên dương" })
    .int({ error: "version phải là số nguyên dương" })
    .positive({ error: "version phải là số nguyên dương" })
    .max(1_000_000, { error: "version vượt giới hạn" }),
});

const preliminaryFields = {
  preliminaryAssessment: z.enum(PRELIMINARY_ASSESSMENTS, {
    error: "Nhận định sơ bộ không hợp lệ",
  }),
  preliminaryNote: optionalText(2000),
};

/** Báo cáo của phụ huynh / GVCN (US1). */
export const reportFoodSafetyIncidentSchema = z.strictObject({
  title: requiredText(255),
  description: z
    .string({ error: "Mô tả phải là văn bản" })
    .trim()
    .min(10, { error: "Mô tả cần ít nhất 10 ký tự" })
    .max(2000, { error: "Mô tả chỉ nhận tối đa 2000 ký tự" }),
  reportedSymptomaticCount: z
    .number({ error: "Số người có triệu chứng phải là số nguyên" })
    .int({ error: "Số người có triệu chứng phải là số nguyên" })
    .min(1, { error: "Số người có triệu chứng tối thiểu là 1" })
    .max(100_000, { error: "Số người có triệu chứng tối đa 100000" }),
  symptomDescription: optionalText(2000),
  occurredAt: z.iso
    .datetime({
      offset: true,
      error: "Thời điểm xảy ra phải là ISO 8601 có múi giờ",
    })
    .transform((value) => new Date(value))
    .optional(),
  classId: requestUuidSchema.optional(),
});

/** BGH tự lập hồ sơ gửi thẳng ATTP (US3, Q20). */
export const directFoodSafetyIncidentSchema =
  reportFoodSafetyIncidentSchema.extend(preliminaryFields);

/** BGH xác minh sơ bộ và chuyển ATTP (US2). */
export const forwardFoodSafetyIncidentSchema =
  z.strictObject(preliminaryFields);

/** BGH hủy khi trùng/nhập sai (Q4). */
export const cancelFoodSafetyIncidentSchema = z.strictObject({
  reason: z.enum(CANCELLATION_REASONS, { error: "Lý do hủy không hợp lệ" }),
  note: requiredText(2000),
});

export const addFoodSafetyIncidentAllocationsSchema = z.strictObject({
  mealAllocationIds: z
    .array(requestUuidSchema, { error: "Danh sách suất ăn không hợp lệ" })
    .min(1, { error: "Cần ít nhất một suất ăn" })
    .max(50, { error: "Tối đa 50 suất ăn mỗi lần" })
    .refine((ids) => new Set(ids).size === ids.length, {
      error: "Danh sách suất ăn bị trùng",
    }),
});

export const validateFoodSafetyIncidentListQuery = (value: unknown) =>
  parseRequest(foodSafetyIncidentListQuerySchema, value ?? {});
export const validateFoodSafetyIncidentParams = (value: unknown) =>
  parseRequest(foodSafetyIncidentParamsSchema, value);
export const validateFoodSafetyIncidentSnapshotParams = (value: unknown) =>
  parseRequest(foodSafetyIncidentSnapshotParamsSchema, value);
export const validateReportFoodSafetyIncident = (value: unknown) =>
  parseRequest(reportFoodSafetyIncidentSchema, value);
export const validateDirectFoodSafetyIncident = (value: unknown) =>
  parseRequest(directFoodSafetyIncidentSchema, value);
export const validateForwardFoodSafetyIncident = (value: unknown) =>
  parseRequest(forwardFoodSafetyIncidentSchema, value);
export const validateCancelFoodSafetyIncident = (value: unknown) =>
  parseRequest(cancelFoodSafetyIncidentSchema, value);
export const validateAddFoodSafetyIncidentAllocations = (value: unknown) =>
  parseRequest(addFoodSafetyIncidentAllocationsSchema, value);
