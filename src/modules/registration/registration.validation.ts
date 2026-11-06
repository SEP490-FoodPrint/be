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

const searchMessage = "Mã tìm kiếm phải có dạng FP-REG-00001";
const registrationSearchSchema = z
  .string({ error: searchMessage })
  .trim()
  .toUpperCase()
  .refine(
    (value) => {
      if (value === "") return true;
      if (!/^FP-REG-(?:[0-9]{5}|[1-9][0-9]{5,18})$/.test(value)) return false;
      const number = BigInt(value.slice(7));
      return number > 0n && number <= 9_223_372_036_854_775_807n;
    },
    { error: searchMessage },
  )
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
