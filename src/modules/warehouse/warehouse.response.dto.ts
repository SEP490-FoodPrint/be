/** Mức cảnh báo đồ lưu kho: URGENT khi ngày bắt đầu thiếu là hôm nay hoặc ngày mai. */
export type StockAlertLevel = "URGENT" | "UPCOMING";

export interface StockAlertItemDTO {
  ingredientId: string;
  name: string;
  unit: string;
  /** Tổng nhu cầu còn lại của các thực đơn đã duyệt từ hôm nay. */
  required: string;
  /** Tồn kho còn trống (đã trừ phần giữ cho mẻ nấu / gia vị chung). */
  onHand: string;
  /** Yêu cầu nhập đồ lưu kho đã gửi NCC nhưng chưa nhận đủ. */
  pending: string;
  /** Lượng cần nhập thêm để đủ cho các ngày còn lại. */
  shortage: string;
  /** Ngày đầu tiên kho không đủ (YYYY-MM-DD). */
  firstShortDate: string;
  level: StockAlertLevel;
}

export interface StockAlertsResponseDTO {
  date: string;
  /** Ngày thực đơn đã duyệt xa nhất được tính (null khi chưa có). */
  horizonEnd: string | null;
  items: StockAlertItemDTO[];
}
