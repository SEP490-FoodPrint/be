import type { WeeklyMenuStatus } from "../../generated/prisma/enums";

export interface AcademicWeekDTO {
  weekNumber: number;
  weekLabel: string;
  label: string;
  weekStartDate: string;
  weekEndDate: string;
  isCurrentWeek: boolean;
}

export interface MenuAcademicYearDTO {
  id: string;
  academicYear: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  holidays: { date: string; reason: string | null }[];
  weeks: AcademicWeekDTO[];
}

export interface MenuAcademicCalendarDTO {
  academicYears: MenuAcademicYearDTO[];
}

export interface MenuWeekScheduleDTO {
  targetDate: string;
  targetDayOfWeek: number;
  targetDayLabel: string;
  isTargetSchoolDay: boolean;
  weekNumber: number | null;
  weekLabel: string | null;
  academicYear: string | null;
  weekStartDate: string;
  weekEndDate: string;
  weeklyMenuId: string | null;
  weeklyMenuStatus: WeeklyMenuStatus | null;
  weeklyMenuTitle: string | null;
  days: {
    date: string;
    dayOfWeek: number;
    dayLabel: string;
    isSchoolDay: boolean;
    isHoliday?: boolean;
    holidayReason?: string | null;
    hasMenu: boolean;
    menuDayId: string | null;
    status: string;
    dishCount: number;
  }[];
  totalSchoolDays: number;
  completedDays: number;
  missingDays: string[];
  isWeekComplete: boolean;
}

export interface MenuSummaryDTO {
  id: string;
  schoolId: string;
  weekStartDate: string;
  title: string | null;
  status: WeeklyMenuStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MenuSummaryPageResponseDTO {
  items: MenuSummaryDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
