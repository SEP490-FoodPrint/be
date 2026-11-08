import type {
  SchoolSupplierStatus,
  EntityStatus,
} from "../../generated/prisma/enums";
export type SchoolSupplierItemDTO = {
  id: string;
  schoolId: string;
  supplierId: string;
  status: SchoolSupplierStatus;
  linkedAt: string;
  unlinkedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SchoolSupplierListResponseDTO = {
  items: SchoolSupplierItemDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
};
export type SchoolSupplierSchoolResponseDTO = {
  items: (SchoolSupplierItemDTO & {
    supplierName: string;
    supplierStatus: EntityStatus;
  })[];
  pagination: { page: number; limit: number; total: number; hasNext: boolean };
};
