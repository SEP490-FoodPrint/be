import type { z } from "zod";
import type { allergyCatalogQuerySchema } from "./allergy.validation";
export type AllergyCatalogQuery = z.infer<typeof allergyCatalogQuerySchema>;
