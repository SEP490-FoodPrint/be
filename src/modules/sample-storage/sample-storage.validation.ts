import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

export const sampleStorageStatusEnum = z.enum(
  ["ACTIVE", "MAINTENANCE", "INACTIVE"],
  {
    error: "Trạng thái chỉ nhận ACTIVE, MAINTENANCE hoặc INACTIVE",
  },
);

export const sampleStorageWriteSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
  name: requiredText(255).min(2, { error: "Tên tủ phải từ 2 ký tự trở lên" }),
  location: requiredText(255).min(2, {
    error: "Vị trí đặt tủ không được để trống",
  }),
  temperatureRange: z.string().trim().max(100).default("2°C - 8°C"),
  currentTemperature: z
    .union([z.number(), z.string()])
    .transform((v) =>
      v === "" || v === null || v === undefined ? null : Number(v),
    )
    .refine((v) => v === null || (!isNaN(v) && v >= -30 && v <= 50), {
      error: "Nhiệt độ hiện tại phải từ -30°C đến 50°C",
    })
    .nullable()
    .optional(),
  capacity: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => !isNaN(v) && Number.isInteger(v) && v >= 1 && v <= 500, {
      error: "Sức chứa tối đa phải là số nguyên từ 1 đến 500",
    })
    .default(40),
  compartmentCount: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => !isNaN(v) && Number.isInteger(v) && v >= 1 && v <= 20, {
      error: "Số ngăn phải từ 1 đến 20 ngăn",
    })
    .default(3),
  status: sampleStorageStatusEnum.default("ACTIVE"),
  description: z.string().trim().max(1000).nullable().optional(),
});

export type SampleStorageWriteInput = z.infer<typeof sampleStorageWriteSchema>;

export const sampleStorageQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  schoolId: requestUuidSchema.optional(),
});

export type SampleStorageQueryInput = z.infer<typeof sampleStorageQuerySchema>;

export const validateSampleStorageWrite = (value: unknown) =>
  parseRequest(sampleStorageWriteSchema, value);

export const validateSampleStorageQuery = (
  value: unknown,
): SampleStorageQueryInput => sampleStorageQuerySchema.parse(value || {});
