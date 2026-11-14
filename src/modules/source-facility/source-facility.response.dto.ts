export interface SourceFacilityListResponse {
  id: string;
  supplierId: string;
  facilityCode: string | null;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SourceFacilityDetailResponse extends SourceFacilityListResponse {
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface SourceFacilityCreateResponse extends Omit<
  SourceFacilityDetailResponse,
  "facilityCode"
> {
  facilityCode: string;
}

export interface SourceFacilityPageResponse<T = SourceFacilityListResponse> {
  items: T[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
