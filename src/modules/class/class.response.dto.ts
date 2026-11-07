import type { EntityStatus } from "../../generated/prisma/enums";
export type ClassItemDTO = {
  id: string;
  schoolId: string;
  name: string;
  academicYear: string | null;
  registeredMealPortions: number;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
};
export type ClassListResponseDTO = {
  items: ClassItemDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
};
export type ClassSchoolResponseDTO = {
  items: ClassItemDTO[];
  pagination: { page: number; limit: number; total: number; hasNext: boolean };
};
