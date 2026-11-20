import { z } from "zod";
import { parseRequest } from "../../utils/request-validation";

const uuidMessage = "menuId phải là UUID hợp lệ";

export const menuApprovalParamsSchema = z.strictObject({
  menuId: z.uuid({ error: uuidMessage }),
});

export const menuApprovalDecisionSchema = z
  .strictObject({
    submissionVersion: z.iso.datetime().optional(),
    decision: z.enum(["APPROVED", "REVISION_REQUESTED"], {
      error: "Quyết định duyệt không hợp lệ",
    }),
    feedback: z
      .string({ error: "Nhận xét phải là chuỗi ký tự" })
      .trim()
      .max(2000, { error: "Nhận xét tối đa 2000 ký tự" })
      .transform((value) => value || null)
      .optional()
      .transform((value) => value ?? null),
  })
  .superRefine((value, context) => {
    if (value.decision === "REVISION_REQUESTED" && !value.feedback) {
      context.addIssue({
        code: "custom",
        path: ["feedback"],
        message: "Cần nêu lý do yêu cầu chỉnh sửa",
      });
    }
  });

const weekDateMessage = "Ngày phải có định dạng YYYY-MM-DD";

/** date là ngày bất kỳ trong tuần; bỏ trống để server tự chọn tuần mặc định. */
export const menuApprovalWeekQuerySchema = z.strictObject({
  date: z
    .string({ error: weekDateMessage })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: weekDateMessage })
    .refine(
      (value) => {
        const date = new Date(value + "T00:00:00.000Z");
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === value
        );
      },
      { error: "Ngày không hợp lệ" },
    )
    .transform((value) => new Date(value + "T00:00:00.000Z"))
    .optional(),
});

export function validateMenuApprovalWeekQuery(value: unknown) {
  return parseRequest(menuApprovalWeekQuerySchema, value);
}

export function validateMenuApprovalParams(value: unknown) {
  return parseRequest(menuApprovalParamsSchema, value);
}

export function validateMenuApprovalDecision(value: unknown) {
  return parseRequest(menuApprovalDecisionSchema, value);
}
