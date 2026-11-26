# Feature Specification: Sửa code theo kết quả review 24 UC

**Feature Branch**: `fix/uc-review-code-fixes`
**Status**: Đã chốt (các quyết định ghi trong `uc_review/uc_specs/*.md`, mục "Quyết định khi review", review 26–27/11/2026)
**Nguồn**: `.task_specs/TASK-12-uc-review-code-fixes.md` ở thư mục gốc dự án

## 1. Bối cảnh

Khi viết lại đặc tả UC từ code, các chỗ code lệch nghiệp vụ đã chốt, lỗi, hoặc phần cũ không còn dùng được ghi vào mục "Cần sửa code" của từng UC. Spec này gom phần BE của các mục đó.

## 2. Yêu cầu

### Đợt giao, lưu mẫu (UC 16, 22, 23, 24)

- **FR-A1** Chuyến Đợt 2 nấu riêng chỉ chuyển "Chờ xác nhận lấy thêm" khi có phần lấy thêm thật (mẻ không cắt mẫu); không có thì chuyển "Sẵn sàng giao".
- **FR-A2** API NCC xác nhận lấy thêm nhận danh sách lô rỗng khi kế hoạch đã duyệt không có lô nào phải lấy thêm.
- **FR-A4** Đợt 2 tính riêng từng bữa (trưa, xế): suất Đợt 2 mỗi bữa = sĩ số đã chốt của bữa − mốc Đợt 1 của khối; lớp phải chốt mọi bữa có thực đơn cho khối. Áp dụng cho tính nhu cầu, điều kiện "Đợt 2 không cần", kiểm tra lớp chưa chốt khi tạo đơn, chốt ngày điểm danh và lập mẻ Đợt 2.
- **FR-A6** Đợt 1 đã nhận đủ hàng mà chưa từng lập mẻ: khi Kho mở kế hoạch mẻ hoặc tạo đơn Đợt 2, hệ thống chạy lại bước tự động; vẫn lỗi thì trả 409 rõ ràng. Lỗi của bước tự động sau commit ghi log kèm trường, ngày.
- **FR-A8** Danh sách phiếu nhập trả `preparationStage` của chuyến.
- **FR-A9** API duyệt món chỉ nhận Đợt 2.

### Bếp (UC 22-1, 22-2)

- **FR-B2** Chi tiết mẻ trả `sampleStrategy`, `supplyBatchNo`, trạng thái Đợt 2 của ngày và phần thừa Đợt 1 của cùng bữa – món.
- **FR-B5** Ghi nhận nấu xong mẻ chưa chính thức báo "Mẻ chưa chính thức, chưa thể ghi nhận nấu xong."

### Phân bổ suất (UC 23-1, 23-3)

- **FR-C1** Bữa có mẻ theo đợt giao được phép thừa suất: không báo "vượt số suất", lưu mẫu chỉ cần đủ suất đã chốt.

### Thực đơn và khối (UC 19-1, 53-1)

- **FR-D1** Số suất ở màn duyệt thực đơn là tổng suất lớp đăng ký ăn bán trú (lớp đang hoạt động, lọc theo khối của thực đơn).
- **FR-D2** Gỡ `GET /api/v1/menus/:menuId/approval-detail` và các trường `medicalReview`, `compliance` không dùng.
- **FR-D3** Mọi tài khoản trường có `class.manage`, `class.view` hoặc `menu.view` xem được khối của trường; thêm/sửa/xóa vẫn chỉ BGH. Xóa khối đã có thực đơn trả 409 "Khối đã có thực đơn, không thể xóa."; danh sách trả `menuCount`.

### Trang công khai (UC 13, 14)

- **FR-E4** Khẩu phần một suất ở chi tiết bữa ăn công khai = khẩu phần khối (đơn vị mốc chuẩn); không có thì mốc chuẩn; chỉ món chưa có mốc chuẩn mới dùng kích thước suất trình bày / tổng nguyên liệu chính.
- **FR-E7** Gỡ `GET /api/meal-traceability` và `GET /api/meal-traceability/public/schools/:schoolCode/classes`.

## 3. Ngoài phạm vi

Các mục gỡ code cũ cần kiểm dữ liệu trước (B4 mẻ `UNCONFIRMED`, B7 nhập lượng mẫu cũ, C3/C4 phân bổ cũ theo lô, F1 trạng thái `APPROVED`) để lại tới khi chạy truy vấn kiểm trên DB.
