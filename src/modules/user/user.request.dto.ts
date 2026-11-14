import type { z } from "zod";
import type {
  userListQuerySchema,
  userSchoolParamsSchema,
  userSchoolUserParamsSchema,
  createSchoolAccountBodySchema,
  updateSchoolAccountBodySchema,
  updateAccountStatusBodySchema,
} from "./user.validation";

export type UserListRequestDTO = z.infer<typeof userListQuerySchema>;
export type UserSchoolRequestDTO = {
  query: UserListRequestDTO;
  params: z.infer<typeof userSchoolParamsSchema>;
};
export type CreateSchoolAccountDTO = {
  params: z.infer<typeof userSchoolParamsSchema>;
  body: z.infer<typeof createSchoolAccountBodySchema>;
};
export type UpdateSchoolAccountDTO = {
  params: z.infer<typeof userSchoolUserParamsSchema>;
  body: z.infer<typeof updateSchoolAccountBodySchema>;
};
export type UpdateAccountStatusDTO = {
  params: z.infer<typeof userSchoolUserParamsSchema>;
  body: z.infer<typeof updateAccountStatusBodySchema>;
};
