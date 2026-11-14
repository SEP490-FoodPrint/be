import { z } from "zod";

export const operation = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    text: z
      .string()
      .max(1000)
      .refine((text) => text.trim().length > 0),
  }),
  z.strictObject({
    action: z.literal("verify"),
    recordId: z.string().regex(/^0x[0-9a-f]{64}$/i),
    text: z.string().max(1000),
  }),
]);
