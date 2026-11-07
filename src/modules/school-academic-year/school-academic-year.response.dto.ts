export interface HolidayResponseDTO {
  startDate: string;
  endDate: string;
  reason: string;
}

export interface AcademicYearResponseDTO {
  id: string;
  academicYear: string;
  startDate: string;
  endDate: string;
  holidays: HolidayResponseDTO[];
  createdAt: string;
  updatedAt: string;
}
