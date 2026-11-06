import { z } from "zod";
import { parseRequest } from "../../utils/request-validation";

const uuidMessage = "menuId phải là UUID hợp lệ";

export const menuApprovalParamsSchema = z.strictObject({
  menuId: z.uuid({ error: uuidMessage }),
});

export const menuApprovalDecisionSchema = z
  .strictObject({
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

export function validateMenuApprovalParams(value: unknown) {
  return parseRequest(menuApprovalParamsSchema, value);
}

export function validateMenuApprovalDecision(value: unknown) {
  return parseRequest(menuApprovalDecisionSchema, value);
}
