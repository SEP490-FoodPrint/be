import type { z } from "zod";
import type {
  userListQuerySchema,
  userSchoolParamsSchema,
} from "./user.validation";
export type UserListRequestDTO = z.infer<typeof userListQuerySchema>;
export type UserSchoolRequestDTO = {
  query: UserListRequestDTO;
  params: z.infer<typeof userSchoolParamsSchema>;
};
