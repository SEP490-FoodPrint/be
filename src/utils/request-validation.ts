import { z } from "zod";
import { HttpError } from "./http-error";

export class RequestValidationError extends HttpError {
  constructor(public readonly fields: { field: string; message: string }[]) {
    super(400, "Nội dung yêu cầu không hợp lệ");
  }
}

export function parseRequest<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new RequestValidationError(
    result.error.issues.flatMap((issue) => {
      if (issue.code === "unrecognized_keys") {
        return issue.keys.map((key) => ({
          field: [...issue.path, key].join("."),
          message: "Trường không được phép",
        }));
      }
      return [
        {
          field: issue.path.length ? issue.path.join(".") : "body",
          message: /[^\u0020-\u007E]/.test(issue.message)
            ? issue.message
            : "Giá trị không hợp lệ",
        },
      ];
    }),
  );
}

export function requiredText(maximum: number) {
  return z
    .string({ error: "Trường phải là văn bản" })
    .trim()
    .min(1, { error: "Trường không được để trống" })
    .max(maximum, { error: `Trường chỉ nhận tối đa ${maximum} ký tự` });
}

export const requestUuidSchema = z
  .string({ error: "ID phải là UUID hợp lệ" })
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, {
    error: "ID phải là UUID hợp lệ",
  })
  .transform((value) => value.toLowerCase());
