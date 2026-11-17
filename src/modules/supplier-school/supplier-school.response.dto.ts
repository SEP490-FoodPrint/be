export interface SupplierSchoolPagination {
  page: number;
  limit: number;
  hasNext: boolean;
}

export interface SupplierSchoolRelationshipSummary {
  status: "ACTIVE" | "SUSPENDED" | "UNLINKED";
  linkedAt: string;
}

export interface SupplierSchoolRelationshipDetail extends SupplierSchoolRelationshipSummary {
  suspendedAt: string | null;
  unlinkedAt: string | null;
  suspensionReason: string | null;
  unlinkReason: string | null;
}

export interface SupplierSchoolListItem {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  relationship: SupplierSchoolRelationshipSummary;
}

export interface SupplierSchoolDetail extends Omit<
  SupplierSchoolListItem,
  "relationship"
> {
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  boardingScale: string | null;
  relationship: SupplierSchoolRelationshipDetail;
}

export interface SupplierSchoolListResponse {
  items: SupplierSchoolListItem[];
  pagination: SupplierSchoolPagination;
}

export interface SupplierSchoolContractDocumentMetadata {
  id: string;
  kind: "SIGNED_CONTRACT" | "APPENDIX";
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface SupplierSchoolContractIngredient {
  id: string;
  name: string;
}

export interface SupplierSchoolContract {
  id: string;
  number: string | null;
  status: "ACTIVE" | "CLOSED";
  signedOn: string | null;
  startsOn: string | null;
  endsOn: string | null;
  scopeNote: string | null;
  ingredients: SupplierSchoolContractIngredient[];
  activatedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  documents: SupplierSchoolContractDocumentMetadata[];
}

export interface SupplierSchoolContractListResponse {
  items: SupplierSchoolContract[];
  pagination: SupplierSchoolPagination;
}

export type AllowedContractDocumentMimeType =
  "application/pdf" | "image/png" | "image/jpeg";

/**
 * Raw binary DTO for contract document content delivery; never serialize as JSON.
 */
export interface SupplierSchoolDocumentBinary {
  fileName: string;
  mimeType: AllowedContractDocumentMimeType;
  content: Uint8Array;
}
