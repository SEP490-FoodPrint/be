import { ROLES } from "../../constants/roles";
import type { AuthorizationClient } from "../../utils/authorization";

/** Truy vấn cho luồng cán bộ ATTP cập nhật email lần đầu (specs/authority-officer-accounts FR-005). */
export const emailSetupRepository = {
  async emailTaken(client: AuthorizationClient, email: string) {
    return (await client.user.count({ where: { email } })) > 0;
  },
  /** Khóa dòng tài khoản rồi đọc lại trạng thái chờ cập nhật email. */
  async lockPendingOfficer(tx: AuthorizationClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${userId}::uuid FOR UPDATE`;
    return tx.user.findFirst({
      where: {
        id: userId,
        roleCode: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
        communeFoodSafetyUnitId: { not: null },
        email: null,
        emailVerifiedAt: null,
        status: "UNVERIFIED",
      },
      select: { id: true },
    });
  },
  activate(
    tx: AuthorizationClient,
    userId: string,
    email: string,
  ): Promise<{ id: string }> {
    return tx.user.update({
      where: { id: userId },
      data: { email, emailVerifiedAt: new Date(), status: "ACTIVE" },
      select: { id: true },
    });
  },
};
export type EmailSetupRepository = typeof emailSetupRepository;
