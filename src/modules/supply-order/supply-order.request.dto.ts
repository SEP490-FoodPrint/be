import type { z } from "zod";
import type {
  supplyOrderListQuerySchema,
  supplyOrderAcceptParamsSchema,
  supplyOrderDetailParamsSchema,
  supplyOrderEmptySchema,
} from "./supply-order.validation";
export type SupplyOrderListRequestDTO = z.infer<
  typeof supplyOrderListQuerySchema
>;
export type SupplyOrderAcceptParamsRequestDTO = z.infer<
  typeof supplyOrderAcceptParamsSchema
>;
export type SupplyOrderAcceptBodyRequestDTO = z.infer<
  typeof supplyOrderEmptySchema
>;
export type SupplyOrderDetailParamsRequestDTO = z.infer<
  typeof supplyOrderDetailParamsSchema
>;
