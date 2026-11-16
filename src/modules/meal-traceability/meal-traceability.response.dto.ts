export interface SchoolDto {
  id: string;
  name: string;
  code: string;
  address: string | null;
}

export interface ClassInfoDto {
  id: string;
  name: string;
  academicYear: string | null;
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

export interface RetainedSampleDto {
  id: string;
  status: string;
  quantity: number | null;
  unit: string | null;
  storageLocation: string | null;
  photoPublicId: string | null;
  photoHash: string | null;
  sampledAt: string;
}

export interface SourceFacilityDto {
  id: string;
  name: string;
  facilityCode: string | null;
  address: string | null;
}

export interface CertificationDto {
  certificationType: string;
  certificateNo: string;
}

export interface DeliveryApprovalDto {
  decision: string;
  decidedAt: string;
  photoPublicId: string | null;
}

export interface DeliveryTraceDto {
  id: string;
  deliveryNo: string;
  vehiclePlate: string | null;
  receivedAt: string | null;
  supplierName: string;
  taxCode: string | null;
  supplierAddress: string | null;
  certifications: CertificationDto[];
  inspectionApproval: DeliveryApprovalDto | null;
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
  status: string;
  confirmedAt: string | null;
  completedAt: string | null;
  retainedSample: RetainedSampleDto | null;
  ingredients: IngredientTraceDto[];
}

export interface DishTraceDto {
  dishId: string;
  dishName: string;
  dishCategory: string;
  batches: BatchTraceDto[];
}

export interface MealTraceabilityResponseDto {
  school: SchoolDto;
  classInfo: ClassInfoDto;
  allocation: AllocationDto;
  dishes: DishTraceDto[];
  blockchainProof: null;
}
