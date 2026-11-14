# Kế hoạch triển khai

Thêm quan hệ thực đơn–khối và bộ định lượng món–khối với liên kết cùng trường. Giữ định lượng cũ như bộ mặc định lịch sử; bộ theo khối phải được chọn rõ khi lập thực đơn khối. Mọi cập nhật được khóa trong transaction trường để ngăn tạo phạm vi chồng nhau.

Frontend chọn các khối ở bước tạo thực đơn và lọc xem tuần. Danh mục món cho phép quản lý định lượng từng khối. Các màn bếp và phân bổ phải truyền phạm vi thực đơn, không tự chọn bản đầu tiên trong tuần.

## Constitution Check

- Phân lớp: validation, request/response DTO, repository và service có trách nhiệm riêng.
- Phân quyền: dùng trường đã xác thực, không nhận schoolId từ client.
- Dữ liệu: migration mới, giữ dữ liệu cũ; không deploy, seed hay thay đổi Azure.
- Transaction: khóa trường, kiểm tra phạm vi và snapshot trong cùng giao dịch.
- Hợp đồng: giữ envelope, thêm khối và định lượng rõ ràng.
- Spec: spec/plan/tasks được ghi trước mã triển khai.

## Kiểm chứng

Chạy Prisma validate/generate, typecheck/build/lint BE, các kiểm thử nghiệp vụ và hợp đồng liên quan; build FE. Migration chỉ kiểm thử trên PostgreSQL tạm được chỉ định rõ nếu có môi trường.

## Tiến độ

Đã nối phạm vi khối từ danh mục công thức tới tạo/lưu/gửi duyệt thực đơn, lịch tuần, dị ứng, nhu cầu nấu và phân bổ. Lịch tuần trả `availableMenus`, nhận `menuId` hoặc tập `gradeIds` chính xác; không tự chọn một bản khi có nhiều thực đơn. Preview dị ứng nhận `gradeIds` và kiểm tra khối cùng trường. Định lượng không đổi của bữa đã lưu giữ snapshot ngay cả khi danh mục đã thay đổi.

Frontend đã có nhập định lượng theo khối, chọn khối khi lập thực đơn, chọn thực đơn trong các màn danh sách và bếp; màn duyệt hiển thị tên khối. API phân bổ trả lớp hợp lệ theo lô và kiểm tra lại phạm vi khi lưu, đồng thời kiểm tra đủ suất theo từng thực đơn thay vì chỉ tổng theo bữa.

Mã và kiểm thử đã hoàn tất; chưa áp dụng migration hoặc kiểm chứng trên dữ liệu thật. Kết quả lệnh và giới hạn kiểm tra được ghi tại `verification.md`.
