export interface HomeroomTeacherResponseDTO {
  id: string;
  fullName: string;
  username: string;
  assignedAt: string;
}

export interface ClassListItemResponseDTO {
  id: string;
  schoolId: string;
  name: string;
  academicYear: string | null;
  registeredMealPortions: number;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
  homeroomTeacher: HomeroomTeacherResponseDTO | null;
  canAssign: boolean;
}

export interface ClassListResponseDTO {
  items: ClassListItemResponseDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}

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
