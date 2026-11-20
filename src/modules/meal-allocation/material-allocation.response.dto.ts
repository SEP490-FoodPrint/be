import type { MaterialEntry, MaterialSource } from "./material-allocation";

export interface MaterialPlanResponseDTO {
  status: "READY";
  date: string;
  mealType: "LUNCH" | "AFTERNOON";
  revision: string;
  planId: string;
  algorithmVersion: 2;
  optimal: boolean;
  entries: (MaterialEntry & {
    className: string;
    gradeId: string;
    gradeName: string;
    dishName: string;
    batchNumber: number | null;
    massKg: string;
  })[];
  totals: {
    demandId: string;
    dishId: string;
    className: string;
    gradeId: string;
    requiredPortions: string;
    allocatedPortions: string;
  }[];
  groups: {
    gradeId: string;
    dishId: string;
    gradeName: string;
    dishName: string;
    requiredPortions: string;
    allocatedPortions: string;
    requiredMassKg: string;
    allocatedMassKg: string;
    availability: {
      batchId: string;
      batchNumber: number | null;
      availablePortions: string;
    }[];
  }[];
  remaining: MaterialSource[];
}
