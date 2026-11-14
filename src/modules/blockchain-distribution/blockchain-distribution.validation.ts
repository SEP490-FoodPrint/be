import { z } from "zod";

export const anchorManualSchema = z.strictObject({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  schoolId: z.string().uuid().optional(),
  allocationIds: z.array(z.string().uuid()).optional(),
});

export const listAnchorsQuerySchema = z.strictObject({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  schoolId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

export type AnchorManualInput = z.infer<typeof anchorManualSchema>;
export type ListAnchorsQueryInput = z.infer<typeof listAnchorsQuerySchema>;
