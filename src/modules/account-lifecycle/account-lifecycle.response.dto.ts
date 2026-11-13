import type { AccountStatus, IntakeState } from "../../generated/prisma/client";

export interface LifecycleResponseDTO {
  userId: string;
  roleCode: string;
  accountStatus: AccountStatus;
  targetType: "SCHOOL" | "SUPPLIER" | "OFFICER";
  intakeState: IntakeState;
  updatedAt: string;
}

export interface DeactivateResponseDTO {
  userId: string;
  targetType: "SCHOOL" | "SUPPLIER" | "OFFICER";
  status: "DEACTIVATED";
  affectedAccountCount: number;
}
