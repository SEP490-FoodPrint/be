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

Phần đầu đã thêm schema, migration chưa áp dụng và bộ định lượng món theo khối trên API danh mục/preview. Sáu kiểm thử recipe đã đạt, gồm so sánh sau quy đổi đơn vị, không sửa dữ liệu đầu vào và chặn khối thiếu/khác định lượng. Chưa nối phạm vi khối vào tạo thực đơn, nhu cầu, mẻ, phân bổ và frontend; toàn bộ tính năng chưa sẵn sàng sử dụng.

Phần tiếp theo đã nối `gradeIds` vào tạo thực đơn và bắt buộc dùng bộ định lượng các khối đã chọn cho ngày có thể chỉnh sửa. Giữ nguyên snapshot của ngày đã duyệt. Chặn khối ngoài trường, phạm vi chồng nhau và thay đổi khối của thực đơn có sẵn. Dị ứng khi tạo/gửi duyệt và nhu cầu/dị ứng khi lập mẻ dùng phạm vi lớp theo ngày thực đơn. Typecheck và compile BE đạt; 27 kiểm thử menu/create và cooking đạt. Chưa hoàn thiện chọn nhiều thực đơn trong lịch tuần, lọc phân bổ và frontend; chưa áp dụng migration.
