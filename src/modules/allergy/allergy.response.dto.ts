export interface AllergyCatalogRowDTO {
  classId: string;
  className: string;
  academicYear: string | null;
  /** Nhóm dị ứng trong lớp: các dòng cùng groupNo là một nhóm học sinh cùng tránh các nguyên liệu đó. */
  groupNo: number;
  ingredientEntryId: string;
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  /** Nhà cung cấp của nguyên liệu dị ứng. */
  supplierName: string | null;
  /** Số học sinh của nhóm dị ứng (giống nhau trên mọi dòng của nhóm). */
  affectedCount: number;
  updatedAt: string;
}
