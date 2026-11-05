import type { z } from "zod";
import { HttpError } from "./http-error";

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "request";
    return `${path}: ${issue.message}`;
  });
  throw new HttpError(
    400,
    `Dữ liệu yêu cầu không hợp lệ: ${details.join("; ")}`,
  );
}
