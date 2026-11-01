# API Tổng quan trường học

`GET /api/school-overview` đọc dữ liệu thực từ PostgreSQL cho các biểu đồ Tổng quan.
API dùng phiên đăng nhập hiện hành, yêu cầu `dashboard.view` và tài khoản thuộc
trường hợp lệ. `schoolId` lấy từ principal, không nhận trường do client chỉ định.

Response trong envelope chuẩn gồm:

- `school`: ID và tên trường.
- `menus`: các tuần thực đơn, title, status và weekStartDate; cần `menu.view`.
- `complaints`: số phản ánh theo status/type; cần `meal_complaint.view`.
- `suppliers`: số quan hệ theo status; cần `supplier_relationship.view` hoặc
  `supplier_relationship.manage`.
- `incidents`: ID, tiêu đề, status, occurredAt và createdAt; cần
  `food_safety_incident.view`.
- `updatedAt`: thời điểm tạo kết quả trả về.

Thiếu quyền đọc một nhóm trả `null`; có quyền nhưng chưa có bản ghi trả mảng rỗng.
Quyền dashboard không thay thế quyền nghiệp vụ. Mọi query đều giới hạn trong
trường của principal và chạy trong cùng transaction đọc.

Endpoint không ghi dữ liệu, không tạo seed, không thay đổi schema hoặc role grants.
Các biểu đồ FE tính số lượng/phân bổ từ dữ liệu trả về, không bổ sung chỉ số
hài lòng, tỷ lệ đạt chuẩn hoặc tỷ lệ đúng hạn chưa có nguồn.

Kiểm thử trong `tests/school-overview.test.ts`, được đăng ký vào `test:unit`, kiểm
tra permission, phạm vi trường và sự khác nhau giữa dữ liệu rỗng với thiếu quyền.

# Dữ liệu Tổng quan trường học

Frontend gọi `GET /api/school-overview` với Bearer JWT từ `POST /api/auth/login`.
API đọc thực đơn, phản ánh, liên kết nhà cung cấp và sự cố từ PostgreSQL theo
`schoolId` của tài khoản đã xác thực. `dashboard.view` không thay thế quyền xem
từng module: phần thiếu quyền trả `null`, UI hiển thị dấu gạch thay vì số 0.

RoleSwitcher vẫn có trên frontend. Chuyển vai trò dẫn tới đăng nhập tài khoản
tương ứng; frontend không tự tạo token hoặc tự cấp quyền.

## Seed được thực hiện theo yêu cầu trên Azure dev

DB đích: `foodprint_db`, schema `foodprint`. Kết nối bằng biến `DB_*` trong
`.env` không được commit. `AZURE_DATABASE_HOST` phải khớp chính xác hostname;
seed Azure cần cờ `--azure`, TLS và `SEED_TEST_PASSWORD` để tạo tài khoản mới.

```powershell
node node_modules/tsx/dist/cli.mjs src/scripts/seed-menu-approval.ts --azure
node node_modules/tsx/dist/cli.mjs src/scripts/seed-school-overview.ts --azure
```

Trường test có ID `10000000-0000-4000-8000-000000000001`; tài khoản
`school_bgh`, `school_admin`, `school_health` thuộc trường này. Mật khẩu tài
khoản mới lấy từ `SEED_TEST_PASSWORD`, không dùng mật khẩu database.

Seed thực đơn giữ nguyên dataset nếu menu test đã tồn tại; seed Tổng quan thêm
bản ghi theo ID cố định và bỏ qua bản ghi trùng, không reset kết quả duyệt.
Không sửa role-permission hiện có. Các tình huống phản ánh/sự cố được gắn `[TEST]`.

Dataset: 4 tuần thực đơn, 20 ngày với 140 lượt món, 6 nhà cung cấp liên kết,
12 nguyên liệu, 3 phản ánh và 2 sự cố. Tài khoản Ban Giám hiệu được đọc cả bốn
nhóm theo quyền hiện có của role; tài khoản khác có thể thấy ít hơn.

DB Azure đang dùng cấu trúc địa chỉ trường mở rộng (`address_line`, `location_id`,
v.v.). Seed không ghi cột `schools.address` cũ; chỉ trả về ID khi tạo trường.
Không chạy `db push` hoặc áp dụng script diff để xóa các cột/bảng mở rộng.
