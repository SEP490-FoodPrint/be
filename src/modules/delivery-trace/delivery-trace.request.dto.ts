import type { z } from "zod";
import type {
  publicDeliveryTraceParamsSchema,
  publicDeliveryTraceQuerySchema,
} from "./delivery-trace.validation";

export type PublicDeliveryTraceParamsDTO = z.infer<
  typeof publicDeliveryTraceParamsSchema
>;

export type PublicDeliveryTraceQueryDTO = z.infer<
  typeof publicDeliveryTraceQuerySchema
>;
