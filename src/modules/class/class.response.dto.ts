import type { EntityStatus } from "../../generated/prisma/enums";
export type ClassItemDTO = {
  id: string;
  schoolId: string;
  name: string;
  grade: { id: string; name: string } | null;
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
export interface CopyClassesResponseDTO {
  toAcademicYear: string;
  created: ClassItemDTO[];
  skipped: string[];
}
export type ImportRowStatus = "CREATE" | "SKIP" | "ERROR";
export interface ImportRowResponseDTO {
  rowNumber: number;
  name: string;
  registeredMealPortions: number | null;
  teacher: { id: string; fullName: string; username: string } | null;
  status: ImportRowStatus;
  errors: string[];
}
export interface ImportClassesResponseDTO {
  academicYear: string;
  dryRun: boolean;
  summary: { create: number; skip: number; error: number };
  rows: ImportRowResponseDTO[];
  created: ClassItemDTO[];
}
