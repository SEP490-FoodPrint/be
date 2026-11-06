import { z } from "zod";
import { HttpError } from "../../utils/http-error";

function positiveIntegerQuery(name: string, fallback: number) {
  const message = `${name} phải là số nguyên dương`;
  return z
    .string({ error: message })
    .regex(/^[1-9]\d*$/, { error: message })
    .transform(Number)
    .refine(Number.isSafeInteger, {
      error: `${name} vượt giới hạn cho phép`,
    })
    .default(fallback);
}

const registrationSearchSchema = z
  .string({ error: "Từ khóa tìm kiếm phải là chuỗi ký tự" })
  .trim()
  .max(255, { error: "Từ khóa tìm kiếm tối đa 255 ký tự" })
  .transform((value) => value || undefined)
  .optional();

export const registrationListQuerySchema = z
  .strictObject(
    {
      page: positiveIntegerQuery("page", 1),
      limit: positiveIntegerQuery("limit", 20).refine((value) => value <= 100, {
        error: "limit tối đa 100",
      }),
      search: registrationSearchSchema,
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? "Chỉ hỗ trợ tham số page, limit và search"
          : "Tham số danh sách đăng ký không hợp lệ",
    },
  )
  .refine(
    ({ page, limit }) =>
      // Report offset errors only after the individual fields are valid.
      !Number.isSafeInteger(page) ||
      !Number.isSafeInteger(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 100 ||
      (page - 1) * limit <= 2_147_483_647,
    {
      path: ["page"],
      error: "page vượt giới hạn phân trang",
    },
  );

interface RegistrationValidationIssue {
  field: string;
  message: string;
}

export class RegistrationValidationError extends HttpError {
  constructor(public readonly fields: RegistrationValidationIssue[]) {
    super(400, "Tham số danh sách đăng ký không hợp lệ");
  }
}

export function validateRegistrationListQuery(value: unknown) {
  const result = registrationListQuerySchema.safeParse(value);
  if (!result.success) {
    throw new RegistrationValidationError(
      result.error.issues.map((issue) => ({
        field: issue.path.length ? issue.path.join(".") : "query",
        message: issue.message,
      })),
    );
  }
  return result.data;
}
