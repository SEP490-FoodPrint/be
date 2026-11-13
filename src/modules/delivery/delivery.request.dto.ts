import type { z } from "zod";
import type {
  deliveryInspectionQuerySchema,
  deliveryInspectionDecisionSchema,
} from "./delivery.validation";

export type DeliveryInspectionQueryDTO = z.infer<
  typeof deliveryInspectionQuerySchema
>;
export type DeliveryInspectionDecisionDTO = z.infer<
  typeof deliveryInspectionDecisionSchema
>;
