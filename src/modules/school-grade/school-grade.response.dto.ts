export interface SchoolGradeResponse {
  id: string;
  name: string;
  classCount: number;
  /** Số thực đơn đã gán khối: khác 0 thì không xóa được. */
  menuCount: number;
}
