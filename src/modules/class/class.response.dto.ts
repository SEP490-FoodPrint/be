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
  homeroomTeacher: HomeroomTeacherResponseDTO | null;
  canAssign: boolean;
};
export type ClassListItemResponseDTO = ClassItemDTO;
export interface HomeroomTeacherResponseDTO {
  id: string;
  fullName: string;
  username: string;
  assignedAt: string;
}
export type ClassListResponseDTO = {
  items: ClassItemDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
};
export type ClassSchoolResponseDTO = {
  items: ClassItemDTO[];
  pagination: { page: number; limit: number; total: number; hasNext: boolean };
};
export interface AcademicYearsResponseDTO {
  current: string;
  items: string[];
}
export interface EligibleTeacherResponseDTO {
  id: string;
  fullName: string;
  username: string;
  currentClass: { id: string; name: string } | null;
}
export interface EligibleTeachersResponseDTO {
  academicYear: string;
  items: EligibleTeacherResponseDTO[];
}
export interface HomeroomAssignmentResponseDTO {
  classId: string;
  homeroomTeacher: HomeroomTeacherResponseDTO | null;
}
