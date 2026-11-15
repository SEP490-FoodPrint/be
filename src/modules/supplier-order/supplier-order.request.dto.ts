import type { z } from "zod";
import type {
  createFromRequestBodySchema,
  createStandaloneBodySchema,
  createSupplierOrderBodySchema,
  supplierOrderDetailParamsSchema,
  supplierOrderEmptyQuerySchema,
  supplierOrderListQuerySchema,
  supplierOrderOptionsQuerySchema,
} from "./supplier-order.validation";

export type CreateFromRequestBodyDTO = z.infer<
  typeof createFromRequestBodySchema
>;

export type CreateStandaloneBodyDTO = z.infer<
  typeof createStandaloneBodySchema
>;

export type CreateSupplierOrderBodyDTO = z.infer<
  typeof createSupplierOrderBodySchema
>;

export type CreateSupplierOrderRequestDTO = {
  idempotencyKey: string;
  body: CreateSupplierOrderBodyDTO;
};

export type SupplierOrderOptionsQueryDTO = z.infer<
  typeof supplierOrderOptionsQuerySchema
>;

export type SupplierOrderListQueryDTO = z.infer<
  typeof supplierOrderListQuerySchema
>;

export type SupplierOrderDetailParamsDTO = z.infer<
  typeof supplierOrderDetailParamsSchema
>;

export type SupplierOrderEmptyQueryDTO = z.infer<
  typeof supplierOrderEmptyQuerySchema
>;
