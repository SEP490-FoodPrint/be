import type { WardLocationDTO } from "../../utils/ward-location";
export interface SupplierItemResponseDTO {
  id: string;
  name: string;
  taxCode: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Phường/xã của tổ chức; chưa gắn → `null`. */
  location: WardLocationDTO | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}
export interface SupplierListResponseDTO {
  items: SupplierItemResponseDTO[];
  pagination: { page: number; limit: number; total: number; hasNext: boolean };
}
export interface SupplierSummaryResponseDTO {
  total: number;
  activeCount: number;
}
