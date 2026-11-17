import type { z } from "zod";
import type {
  deliveryArrivalBodySchema,
  deliveryArrivalQuerySchema,
  deliveryInspectionQuerySchema,
  deliveryInspectionDecisionSchema,
  deliveryInspectionLookupSchema,
} from "./delivery.validation";

export type DeliveryInspectionQueryDTO = z.infer<
  typeof deliveryInspectionQuerySchema
>;
export type DeliveryInspectionLookupDTO = z.infer<
  typeof deliveryInspectionLookupSchema
>;
export type DeliveryInspectionDecisionDTO = z.infer<
  typeof deliveryInspectionDecisionSchema
>;
export type DeliveryArrivalBodyDTO = z.infer<typeof deliveryArrivalBodySchema>;
export type DeliveryArrivalQueryDTO = z.infer<
  typeof deliveryArrivalQuerySchema
>;
