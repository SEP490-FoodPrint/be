import type { AuthorizationClient } from "../../utils/authorization";
export const profileRepository = {
  update(
    tx: AuthorizationClient,
    id: string,
    input: { fullName?: string; phone?: string | null },
  ) {
    return tx.user.update({
      where: { id },
      data: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
      },
      select: { fullName: true, phone: true },
    });
  },
};
