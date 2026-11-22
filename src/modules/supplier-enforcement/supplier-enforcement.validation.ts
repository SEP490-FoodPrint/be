import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

export const ENFORCEMENT_ACTION_TYPES = [
  "PAUSE_INTAKE",
  "LOCK_ACCOUNT",
  "RESTORE",
] as const;
export const ENFORCEMENT_DECISION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;
export const ENFORCEMENT_EXECUTION_STATUSES = [
  "NOT_APPLIED",
  "APPLIED",
  "FAILED",
] as const;
export const RESTRICTION_TYPES = ["PAUSE_INTAKE", "ACCOUNT_LOCKED"] as const;

const text = (minimum: number, maximum: number, label: string) =>
  z
    .string({ error: `${label} phải là văn bản` })
    .trim()
    .min(minimum, { error: `${label} cần ít nhất ${minimum} ký tự` })
    .max(maximum, { error: `${label} chỉ nhận tối đa ${maximum} ký tự` });

const optionalText = (maximum: number) =>
  z
    .string({ error: "Trường phải là văn bản" })
    .trim()
    .max(maximum, { error: `Trường chỉ nhận tối đa ${maximum} ký tự` })
    .transform((value) => (value ? value : undefined))
    .optional();

export const enforcementIncidentParamsSchema = z.strictObject({
  id: requestUuidSchema,
});

export const enforcementActionParamsSchema = z.strictObject({
  actionId: requestUuidSchema,
});

/** US1: ATTP đề nghị chế tài; LOCK_ACCOUNT bắt buộc đợt kiểm tra làm căn cứ. */
export const requestEnforcementSchema = z
  .strictObject({
    supplierId: requestUuidSchema,
    actionType: z.enum(ENFORCEMENT_ACTION_TYPES, {
      error: "Loại chế tài không hợp lệ",
    }),
    reason: text(10, 2000, "Lý do"),
    evidenceInspectionId: requestUuidSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.actionType === "LOCK_ACCOUNT" && !value.evidenceInspectionId)
      context.addIssue({
        code: "custom",
        path: ["evidenceInspectionId"],
        message: "Khóa tài khoản cần đợt kiểm tra làm căn cứ",
      });
  });

export const approveEnforcementSchema = z.strictObject({
  note: optionalText(2000),
});

export const rejectEnforcementSchema = z.strictObject({
  note: text(1, 2000, "Ghi chú từ chối"),
});

export const enforcementListQuerySchema = z.strictObject({
  page: z.coerce
    .number({ error: "Trang phải là số" })
    .int({ error: "Trang phải là số nguyên" })
    .positive({ error: "Trang phải lớn hơn 0" })
    .default(1),
  limit: z.coerce
    .number({ error: "Số dòng phải là số" })
    .int({ error: "Số dòng phải là số nguyên" })
    .min(1, { error: "Số dòng tối thiểu 1" })
    .max(100, { error: "Số dòng tối đa 100" })
    .default(20),
  incidentId: requestUuidSchema.optional(),
  supplierId: requestUuidSchema.optional(),
  actionType: z
    .enum(ENFORCEMENT_ACTION_TYPES, { error: "Loại chế tài không hợp lệ" })
    .optional(),
  decisionStatus: z
    .enum(ENFORCEMENT_DECISION_STATUSES, {
      error: "Trạng thái quyết định không hợp lệ",
    })
    .optional(),
  executionStatus: z
    .enum(ENFORCEMENT_EXECUTION_STATUSES, {
      error: "Trạng thái thực thi không hợp lệ",
    })
    .optional(),
});

export const validateEnforcementIncidentParams = (value: unknown) =>
  parseRequest(enforcementIncidentParamsSchema, value);
export const validateEnforcementActionParams = (value: unknown) =>
  parseRequest(enforcementActionParamsSchema, value);
export const validateRequestEnforcement = (value: unknown) =>
  parseRequest(requestEnforcementSchema, value);
export const validateApproveEnforcement = (value: unknown) =>
  parseRequest(approveEnforcementSchema, value ?? {});
export const validateRejectEnforcement = (value: unknown) =>
  parseRequest(rejectEnforcementSchema, value);
export const validateEnforcementListQuery = (value: unknown) =>
  parseRequest(enforcementListQuerySchema, value ?? {});
