import type { z } from "zod";
import type {
  unitQuerySchema,
  unitParamsSchema,
  unitCreateSchema,
  unitUpdateSchema,
} from "./measurement-unit.validation";
export type UnitQueryRequest = z.infer<typeof unitQuerySchema>;
export type UnitParamsRequest = z.infer<typeof unitParamsSchema>;
export type UnitCreateRequest = z.infer<typeof unitCreateSchema>;
export type UnitUpdateRequest = z.infer<typeof unitUpdateSchema>;
