import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

export const createSchoolGradeSchema = z.strictObject({
  name: z.string().trim().min(1, "Tên khối là bắt buộc").max(120),
});
export const updateSchoolGradeSchema = createSchoolGradeSchema;
const querySchema = z.strictObject({});
export const validateGradeQuery = (value: unknown) =>
  parseRequest(querySchema, value);
export const validateGradeId = (value: unknown) =>
  parseRequest(requestUuidSchema, value);
export const validateGradeCreate = (value: unknown) =>
  parseRequest(createSchoolGradeSchema, value);
export const validateGradeUpdate = (value: unknown) =>
  parseRequest(updateSchoolGradeSchema, value);
