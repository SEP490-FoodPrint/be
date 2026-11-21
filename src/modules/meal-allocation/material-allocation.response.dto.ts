import type { MaterialEntry, MaterialSource } from "./material-allocation";

export interface MaterialPlanResponseDTO {
  status: "READY";
  date: string;
  mealType: "LUNCH" | "AFTERNOON";
  revision: string;
  algorithmVersion: 2;
  optimal: boolean;
  origin?: "GLPK" | "MANUAL";
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

/** Phương án trả cho trang: không có nguyên liệu cấp, khối lượng và số dư nguồn. */
export type PublicMaterialPlanDTO = Omit<
  MaterialPlanResponseDTO,
  "entries" | "groups" | "remaining"
> & {
  entries: Omit<
    MaterialPlanResponseDTO["entries"][number],
    "materials" | "massKg"
  >[];
  groups: Omit<
    MaterialPlanResponseDTO["groups"][number],
    "requiredMassKg" | "allocatedMassKg"
  >[];
};
