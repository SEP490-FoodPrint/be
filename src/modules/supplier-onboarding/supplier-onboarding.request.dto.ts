import type { z } from "zod";
import type {
  orderDraftSchema,
  orderSendParamsSchema,
  orderSendSchema,
} from "./supplier-onboarding.validation";

export type OrderDraftRequestDTO = z.infer<typeof orderDraftSchema>;
export type OrderSendParamsRequestDTO = z.infer<typeof orderSendParamsSchema>;
export type OrderSendRequestDTO = z.infer<typeof orderSendSchema>;
