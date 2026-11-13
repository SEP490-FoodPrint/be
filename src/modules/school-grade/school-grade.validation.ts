import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

const fields = {
  code: z.string().trim().toUpperCase().min(1, "Mã khối là bắt buộc").max(30),
  name: z.string().trim().min(1, "Tên khối là bắt buộc").max(120),
};
export const createSchoolGradeSchema = z.strictObject(fields);
export const updateSchoolGradeSchema = createSchoolGradeSchema
  .partial()
  .refine(
    ({ code, name }) => code !== undefined || name !== undefined,
    "Cần ít nhất một thông tin cần sửa",
  );
const querySchema = z.strictObject({});
export const validateGradeQuery = (value: unknown) =>
  parseRequest(querySchema, value);
export const validateGradeId = (value: unknown) =>
  parseRequest(requestUuidSchema, value);
export const validateGradeCreate = (value: unknown) =>
  parseRequest(createSchoolGradeSchema, value);
export const validateGradeUpdate = (value: unknown) =>
  parseRequest(updateSchoolGradeSchema, value);
