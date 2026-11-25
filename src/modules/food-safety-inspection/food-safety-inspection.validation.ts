import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

export const INSPECTION_CONCLUSIONS = [
  "SUPPLIER_AT_FAULT",
  "SCHOOL_AT_FAULT",
  "MIXED_FAULT",
  "NOT_FOOD_RELATED",
  "INCONCLUSIVE",
] as const;
export const SUPPLIER_FINDINGS = [
  "AT_FAULT",
  "CLEARED",
  "INCONCLUSIVE",
] as const;
/** Kết luận chung cho phép có NCC AT_FAULT (và bắt buộc có ít nhất một). */
export const SUPPLIER_FAULT_CONCLUSIONS = new Set<string>([
  "SUPPLIER_AT_FAULT",
  "MIXED_FAULT",
]);

const optionalText = (maximum: number) =>
  z
    .string({ error: "Trường phải là văn bản" })
    .trim()
    .max(maximum, { error: `Trường chỉ nhận tối đa ${maximum} ký tự` })
    .transform((value) => (value ? value : undefined))
    .optional();

export const foodSafetyInspectionIncidentParamsSchema = z.strictObject({
  id: requestUuidSchema,
});

export const foodSafetyInspectionParamsSchema = z.strictObject({
  id: requestUuidSchema,
  inspectionId: requestUuidSchema,
});

/** US1: ATTP lập đợt kiểm tra. */
export const planFoodSafetyInspectionSchema = z.strictObject({
  teamDescription: requiredText(2000),
  scheduledAt: z.iso
    .datetime({
      offset: true,
      error: "Thời điểm kiểm tra không hợp lệ.",
    })
    .transform((value) => new Date(value)),
});

/** US2: ATTP ghi kết quả một lần (Q26). */
export const recordFoodSafetyInspectionResultSchema = z
  .strictObject({
    resultSummary: z
      .string({ error: "Tóm tắt kết quả phải là văn bản" })
      .trim()
      .min(10, { error: "Tóm tắt kết quả cần ít nhất 10 ký tự" })
      .max(4000, { error: "Tóm tắt kết quả chỉ nhận tối đa 4000 ký tự" }),
    overallConclusion: z.enum(INSPECTION_CONCLUSIONS, {
      error: "Kết luận chung không hợp lệ",
    }),
    findings: z
      .array(
        z.strictObject({
          supplierId: requestUuidSchema,
          finding: z.enum(SUPPLIER_FINDINGS, {
            error: "Kết luận NCC không hợp lệ",
          }),
          evidenceNote: optionalText(2000),
        }),
        { error: "Danh sách kết luận NCC không hợp lệ" },
      )
      .max(50, { error: "Tối đa 50 NCC mỗi đợt" })
      .refine(
        (items) =>
          new Set(items.map((item) => item.supplierId)).size === items.length,
        { error: "Một NCC chỉ được kết luận một lần" },
      ),
  })
  .superRefine((value, context) => {
    const hasFault = value.findings.some((item) => item.finding === "AT_FAULT");
    if (hasFault !== SUPPLIER_FAULT_CONCLUSIONS.has(value.overallConclusion))
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: hasFault
          ? "Kết luận chung không phải lỗi NCC thì không được có NCC AT_FAULT"
          : "Kết luận lỗi NCC cần ít nhất một NCC AT_FAULT",
      });
  });

/** US3: ATTP đóng hồ sơ. */
export const closeFoodSafetyIncidentSchema = z.strictObject({
  note: optionalText(2000),
});

export const validateFoodSafetyInspectionIncidentParams = (value: unknown) =>
  parseRequest(foodSafetyInspectionIncidentParamsSchema, value);
export const validateFoodSafetyInspectionParams = (value: unknown) =>
  parseRequest(foodSafetyInspectionParamsSchema, value);
export const validatePlanFoodSafetyInspection = (value: unknown) =>
  parseRequest(planFoodSafetyInspectionSchema, value);
export const validateRecordFoodSafetyInspectionResult = (value: unknown) =>
  parseRequest(recordFoodSafetyInspectionResultSchema, value);
export const validateCloseFoodSafetyIncident = (value: unknown) =>
  parseRequest(closeFoodSafetyIncidentSchema, value ?? {});
