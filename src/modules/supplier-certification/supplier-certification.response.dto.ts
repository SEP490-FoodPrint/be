export interface CertificationDTO {
  id: string;
  supplierId: string;
  certificationType: string;
  certificateNo: string;
  issuedDate: string | null;
  expiryDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}
export interface CertificationDocumentDTO {
  id: string;
  field: string;
  format: "pdf" | "png" | "jpg";
  fileName: string;
  bytes: number;
}
export interface SupplierCertificationListDTO {
  items: (CertificationDTO & { documents: CertificationDocumentDTO[] })[];
  pagination: { page: number; limit: number; total: number; hasNext: boolean };
}
export interface CertificationDocumentResponseDTO {
  url: string;
  expiresIn: number;
}
