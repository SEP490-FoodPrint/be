import { z } from "zod";
import { parseRequest, requiredText } from "../../utils/request-validation";

const emailSchema = requiredText(254)
  .toLowerCase()
  .email({ error: "Email không đúng định dạng" });

/** Cán bộ ATTP cập nhật email lần đầu (specs/authority-officer-accounts FR-005). */
export const emailSetupRequestSchema = z.strictObject({ email: emailSchema });
export const emailSetupVerifySchema = z.strictObject({
  email: emailSchema,
  code: z
    .string({ error: "Mã xác minh phải gồm 6 chữ số" })
    .regex(/^[0-9]{6}$/, { error: "Mã xác minh phải gồm 6 chữ số" }),
});

export const validateEmailSetupRequest = (value: unknown) =>
  parseRequest(emailSetupRequestSchema, value);
export const validateEmailSetupVerify = (value: unknown) =>
  parseRequest(emailSetupVerifySchema, value);
