export type IngredientQualityFeedbackStatusDto = "SUBMITTED" | "RESPONDED";

export interface IngredientQualityFeedbackPaginationDto {
  page: number;
  limit: number;
  hasNext: boolean;
}

export interface FeedbackSchoolRefDto {
  id: string;
  name: string;
  code: string | null;
}

export interface FeedbackDeliveryRefDto {
  id: string;
  deliveryNo: string;
}

export interface FeedbackUserRefDto {
  id: string;
  fullName: string;
}

export interface FeedbackIngredientLotRefDto {
  id: string;
  lotCode: string;
}

export interface SupplierFeedbackListItem {
  id: string;
  complaintCode: string;
  title: string;
  school: FeedbackSchoolRefDto;
  delivery: FeedbackDeliveryRefDto;
  status: IngredientQualityFeedbackStatusDto;
  createdAt: string;
  respondedAt: string | null;
}

export interface SupplierFeedbackList {
  items: SupplierFeedbackListItem[];
  pagination: IngredientQualityFeedbackPaginationDto;
}

export interface FeedbackDetail extends SupplierFeedbackListItem {
  description: string;
  updatedAt: string;
  submittedBy: FeedbackUserRefDto;
  ingredientLot: FeedbackIngredientLotRefDto | null;
  supplierResponse: string | null;
  respondedBy: FeedbackUserRefDto | null;
}

export interface LegacyFeedbackListItem {
  id: string;
  deliveryId: string;
  ingredientLotId: string | null;
  submittedByUserId: string;
  title: string;
  description: string;
  status: IngredientQualityFeedbackStatusDto;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyFeedbackList {
  items: LegacyFeedbackListItem[];
  pagination: IngredientQualityFeedbackPaginationDto;
}
