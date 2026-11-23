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
  allocatedPortions: string;
  allocationVersion: number;
  materials: {
    ingredientLotId: string;
    ingredientId: string;
    quantity: string;
    quantityPerPortion: string;
    unit: string;
  }[];
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

/* ---------- Truy xuất chung theo khối ---------- */

export interface GradeInfoDto {
  id: string;
  name: string | null;
}

export interface GradeMealDto {
  mealDate: string;
  mealType: string;
}

/** Một lô nguyên liệu nằm trong đơn giao, dùng cho món đang xem. */
export interface GradeDeliveryLotDto {
  ingredientLotId: string;
  lotCode: string;
  ingredientName: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  sourceFacility: SourceFacilityDto | null;
}

export interface GradeDeliveryDto {
  id: string;
  deliveryNo: string;
  status: string;
  vehiclePlate: string | null;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  approvals: DeliveryApprovalDto[];
  lots: GradeDeliveryLotDto[];
}

/** Nhà cung cấp tham gia cung cấp nguyên liệu cho món, kèm các đơn giao. */
export interface GradeSupplierDto {
  id: string;
  name: string;
  taxCode: string | null;
  address: string | null;
  certifications: CertificationDto[];
  deliveries: GradeDeliveryDto[];
}

/** Mẻ nấu của món (dùng chung cho mọi lớp trong khối), chỉ để hiện mẫu lưu. */
export interface GradeBatchDto {
  cookingBatchId: string;
  batchCode: string;
  status: string;
  confirmedAt: string | null;
  completedAt: string | null;
  retainedSample: RetainedSampleDto | null;
}

/** Các mốc thời gian của quy trình phục vụ món cho khối. */
export interface GradeProcessDto {
  /** Từng đơn giao: xe đến lúc nào, trường kiểm nhận lúc nào. */
  receive: {
    deliveryId: string;
    deliveryNo: string;
    supplierName: string;
    vehiclePlate: string | null;
    arrivedAt: string | null;
    receivedAt: string | null;
  }[];
  prepare: {
    startedAt: string | null;
    completedAt: string | null;
    batchCount: number;
  };
  sample: {
    sampledAt: string | null;
    sampleCount: number;
  };
  deliver: {
    allocatedAt: string | null;
    firstDistributedAt: string | null;
    lastDistributedAt: string | null;
    distributed: boolean;
  };
}

export interface GradeDishTraceDto {
  dishId: string;
  dishName: string;
  dishCategory: string | null;
  process: GradeProcessDto;
  suppliers: GradeSupplierDto[];
  batches: GradeBatchDto[];
}

export interface GradeMealTraceabilityResponseDto {
  school: SchoolDto;
  grade: GradeInfoDto;
  meal: GradeMealDto;
  dishes: GradeDishTraceDto[];
  blockchainProof: BlockchainProofChainResponseDTO | null;
  blockchainProofError: string | null;
}
