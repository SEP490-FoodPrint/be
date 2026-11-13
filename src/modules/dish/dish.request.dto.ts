import type { z } from "zod";
import type { dishRecipeWriteSchema } from "./dish.validation";
export type DishRecipeWrite = z.infer<typeof dishRecipeWriteSchema>;
