import type { BlockchainProofChainResponseDTO } from "../blockchain-proof/blockchain-proof.response.dto";

export interface SchoolDto {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
}

export interface ClassInfoDto {
  id: string;
  name: string;
  academicYear: string | null;
  gradeId: string | null;
  gradeName: string | null;
}

export interface AllocationDto {
  id: string;
  status: string;
  allocatedAt: string | null;
  distributedAt: string | null;
  totalPortions: number;
  mealDate: string;
  mealType: string;
}

export interface SampleStorageUnitDto {
  code: string;
  name: string;
  location: string;
  temperatureRange: string;
}

export interface RetainedSampleDto {
  id: string;
  status: string;
  quantity: number | null;
  unit: string | null;
  storageLocation: string | null;
  storageUnit: SampleStorageUnitDto | null;
  photoUrl: string | null;
  photoHash: string | null;
  sampledAt: string;
  disposedAt: string | null;
}

export interface SourceFacilityDto {
  id: string | null;
  name: string;
  facilityCode: string | null;
  address: string | null;
}

export interface CertificationDto {
  certificationType: string;
  certificateNo: string;
  issuedDate: string | null;
  expiryDate: string | null;
}

/** Một quyết định kiểm nhận của một vai trò; mỗi lần duyệt có một ảnh minh chứng. */
export interface DeliveryApprovalDto {
  roleCode: string;
  roleName: string;
  decision: string;
  reason: string | null;
  decidedAt: string;
  photoUrl: string | null;
  photoHash: string | null;
}

export interface DeliveryTraceDto {
  id: string;
  deliveryNo: string;
  status: string;
  vehiclePlate: string | null;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  supplierName: string;
  taxCode: string | null;
  supplierAddress: string | null;
  certifications: CertificationDto[];
  approvals: DeliveryApprovalDto[];
}

export interface IngredientTraceDto {
  ingredientLotId: string;
  lotCode: string;
  ingredientName: string;
  quantityUsed: number;
  unit: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  sourceFacility: SourceFacilityDto | null;
  delivery: DeliveryTraceDto;
}

export interface BatchTraceDto {
  cookingBatchId: string;
  batchCode: string;
  allocatedPortions: number;
  plannedPortions: number | null;
  status: string;
  confirmedAt: string | null;
  completedAt: string | null;
  completedByName: string | null;
  retainedSample: RetainedSampleDto | null;
  ingredients: IngredientTraceDto[];
}

export interface DishTraceDto {
  dishId: string;
  dishName: string;
  dishCategory: string | null;
  batches: BatchTraceDto[];
}

export interface MealTraceabilityResponseDto {
  school: SchoolDto;
  classInfo: ClassInfoDto;
  allocation: AllocationDto;
  dishes: DishTraceDto[];
  blockchainProof: BlockchainProofChainResponseDTO | null;
  /** Lý do không có chuỗi bằng chứng (blockchain tắt, lỗi đối soát...). */
  blockchainProofError: string | null;
}

export interface PublicSchoolClassDto {
  id: string;
  name: string;
  gradeId: string | null;
  gradeName: string | null;
}
