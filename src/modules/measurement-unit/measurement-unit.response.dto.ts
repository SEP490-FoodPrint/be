export interface MeasurementUnitResponse {
  id: string;
  code: string;
  name: string;
  symbol: string;
  group: string;
  recommendedStep: string;
  status: string;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}
export interface MeasurementUnitPageResponse {
  items: MeasurementUnitResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
