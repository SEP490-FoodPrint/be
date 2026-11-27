# Feature Specification: Sửa lỗi theo kết quả integration test (Report5.2)

**Feature Branch**: `fix/integration-test-fixes`
**Status**: Đã chốt (người dùng yêu cầu sửa 28/11/2026)
**Nguồn**: Round 1 của tab "Manage Ingredient Deliveries" (MID13, MID47) và "Manage Food poisoning report" (FPR01, FPR17) trong file Report5.2_Integration_Test.

## 1. Bối cảnh

Lần chạy integration test Round 1 (API thật trên PostgreSQL tạm) có 4 TC fail. FPR01, FPR17 và MID47 do backend; MID13 do trang chi tiết đơn giao của NCC (FE, repo `fe`) thiếu phần tiến trình.

## 2. Yêu cầu

- **FR-001** (MID47) Bộ lọc ngày của danh sách kiểm nhận (`GET /api/deliveries/inspections`, `period=today` hoặc `date=`) chỉ dùng ngày tạo đơn khi đơn không có ngày hẹn, ngày đến, ngày nhận và không có ngày trường yêu cầu giao. Đơn tạo hôm nay nhưng trường yêu cầu giao ngày khác không hiện vào hôm nay. Thống kê dùng cùng bộ lọc.
- **FR-002** (FPR01) Mỗi bản chuyển hồ sơ lên ATTP (chuyển sau xác minh, lập hồ sơ trực tiếp, bản bổ sung khi gắn thêm suất ăn) có số tham chiếu `<mã hồ sơ>/<lần chuyển>`, trong đó lần chuyển là phiên bản snapshot truy xuất gửi kèm (ví dụ `FP-IC-00007/1`). Hồ sơ chưa có mã thì số tham chiếu để trống. Bản chuyển cũ không được cập nhật lại.
- **FR-003** (FPR17) Khi cán bộ ATTP đóng hồ sơ (INSPECTION_COMPLETED → CLOSED), hệ thống ghi thời điểm đóng (`resolvedAt`) bằng đúng thời điểm của dòng lịch sử CLOSED.
- **FR-004** (MID13, FE) Trang "Chi tiết đơn giao hàng" của NCC hiện thanh tiến trình 4 bước: Chuẩn bị hàng → Vận chuyển đến trường → Trường kiểm nhận → Hoàn thành, dùng component `DeliveryStageStepper` sẵn có. Đơn bị từ chối hoặc đã hủy không hiện thanh tiến trình (banner trạng thái đã giải thích).

## 3. Ngoài phạm vi

- Gán lại số tham chiếu hoặc thời điểm đóng cho dữ liệu cũ (cần truy vấn dữ liệu và quyền riêng).
- Thay đổi schema hoặc migration: các cột `reference_number`, `resolved_at` đã có.
