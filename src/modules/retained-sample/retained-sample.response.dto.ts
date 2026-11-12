export interface RetainedSampleResponseDTO {
  id: string;
  cookingBatchId: string;
  dishId: string;
  recordedByUserId: string;
  sampledAt: string;
  expiresAt: string;
  quantity: string | null;
  unit: string | null;
  storageLocation: string | null;
  status: "STORED" | "DISPOSED";
  disposedAt: string | null;
  disposalNote: string | null;
  createdAt: string;
  updatedAt: string;
  CookingBatch: {
    batchCode: string;
    BatchGroup: { id: string; batchCode: string };
    mealType: "LUNCH" | "AFTERNOON";
    plannedPortions: number | null;
    Dish: { name: string };
  };
}
export interface RetainedSampleListResponseDTO {
  items: RetainedSampleResponseDTO[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    hasNext: boolean;
  };
}
