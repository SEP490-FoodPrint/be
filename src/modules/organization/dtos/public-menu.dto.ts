export interface DishItemDTO {
  id: string;
  name: string;
  portion: string;
  portionSize: number | null;
  portionUnit: string | null;
  order: number | null;
  mealType: "LUNCH" | "AFTERNOON";
  description: string | null;
}

export interface SnackItemDTO {
  id: string;
  name: string;
  desc: string;
  icon: "cake" | "coffee";
}

export interface PortionGroupDTO {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface WeeklyMenuDayDTO {
  id: string;
  dayOfWeek: string;
  date: string;
  dateIso: string;
  status: "SERVED" | "TODAY" | "UPCOMING";
  statusLabel: string;
  isToday: boolean;
  lunchDishes: string[];
  snackSummary: string;
  dishes: DishItemDTO[];
}

export interface PublicDailyMenuDTO {
  date: string;
  dateLabel: string;
  updatedAt: string;
  lunch: {
    title: string;
    servingWindow: string;
    trayImageUrl: string;
    trayType: string;
    standardsNote: string;
    allergyWarning: string;
    dishes: DishItemDTO[];
  };
  snack: {
    title: string;
    servingWindow: string;
    imageUrl: string;
    items: SnackItemDTO[];
    dishes: DishItemDTO[];
  };
}

export interface PublicWeeklyMenuDTO {
  id: string;
  title: string;
  weekNumber: number;
  weekStartDate: string;
  weekRange: string;
  status: string;
  portionGroups: PortionGroupDTO[];
  gradeGroups: Array<{ key: string; label: string }>;
  days: WeeklyMenuDayDTO[];
}
