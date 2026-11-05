import type { z } from "zod";
import type { registrationListQuerySchema } from "./registration.validation";

export type RegistrationListRequestDTO = z.infer<
  typeof registrationListQuerySchema
>;
