# Data Model: Mã hồ sơ đăng ký

**Spec**: [spec.md](spec.md)  
**Design decisions**: [research.md](research.md)

## RegistrationRequest

Giữ nguyên model, bảng `foodprint.registration_requests`, khóa chính UUID và mọi quan hệ hiện có.

| Thuộc tính               | Lưu trữ                      | Hợp đồng bên ngoài       | Ràng buộc                                      |
| ------------------------ | ---------------------------- | ------------------------ | ---------------------------------------------- |
| `id` hiện có             | UUID, primary key            | `id: string`             | Không đổi; tiếp tục dùng cho URL và FK         |
| `registrationNumber` mới | `registration_number bigint` | Không xuất               | Bắt buộc, unique, > 0, default sequence        |
| Mã hồ sơ                 | Không lưu thêm cột chuỗi     | `registrationID: string` | `FP-REG-` + số thập phân đủ tối thiểu 5 chữ số |

Prisma biểu diễn trường mới bằng `BigInt`, `@db.BigInt`, `@map("registration_number")`, `@default(autoincrement())` và `@unique(map: "registration_requests_registration_number_key")`. Giữ `@@schema("foodprint")`. CHECK `registration_requests_registration_number_positive` nằm trong migration SQL.

Các repository input dành cho tạo/cập nhật không nhận `registrationNumber` hoặc `registrationID`. Khi tạo, PostgreSQL cấp số mặc định; khi cập nhật, repository không ghi cột số. Tính bất biến qua các luồng nghiệp vụ được thực thi bằng hợp đồng ghi và kiểm thử; không thêm trigger.

## Sequence

| Thuộc tính                  | Giá trị thiết kế                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Tên                         | `foodprint.registration_requests_registration_number_seq`                                    |
| Kiểu                        | bigint, sequence thông thường có WAL                                                         |
| Start / minimum / increment | 1 / 1 / 1                                                                                    |
| Cache / cycle               | 1 / NO CYCLE                                                                                 |
| Ownership                   | `foodprint.registration_requests.registration_number`                                        |
| Phạm vi                     | Chung cho SCHOOL và SUPPLIER, không reset theo ngày/năm                                      |
| Giới hạn                    | Số nguyên bigint dương tối đa 9223372036854775807; hết dải thì ghi thất bại, không quay vòng |

Sequence là đối tượng hạ tầng cho cột mới, không tạo thêm business model/counter table. Không dùng Redis cho cấp số.

## Định dạng và validation

- `1 → FP-REG-00001`, `9 → FP-REG-00009`, `10 → FP-REG-00010`.
- `99999 → FP-REG-99999`, `100000 → FP-REG-100000`.
- Formatter nhận bigint dương, dùng biểu diễn thập phân và padStart; không ép Number, không cắt chuỗi.
- Mã dài 12 ký tự trong dải 1–99999; độ dài tăng theo số sau dải này, tối đa 26 ký tự trong dải bigint.
- Request không chấp nhận trường mã hoặc số nội bộ ở bất kỳ object strict nào.
- API trả mã như string; không xuất số nội bộ, không dùng mã thay UUID trong URL.

## Bổ sung dữ liệu cũ

Migration dự kiến: `prisma/migrations/20261106000100_registration_number/migration.sql`.

1. Bắt đầu transaction tường minh; lấy khóa bảng xuyên suốt thay đổi.
2. Thêm cột bigint nullable chưa gắn default để tránh tự đánh số hồ sơ cũ theo thứ tự vật lý.
3. Gán số từ 1 bằng thứ tự `submitted_at ASC, id ASC`. Chỉ cập nhật cột mới; UUID, JSON, người nộp, trạng thái, liên kết và tất cả timestamps giữ nguyên.
4. Tạo sequence mới với ownership và cấu hình trên; gắn default nextval; hoàn thiện NOT NULL, unique và CHECK dương.
5. Với N hồ sơ cũ: nếu N > 0, đặt sequence tại max(number) và is_called true để số kế tiếp là N+1; nếu N = 0, đặt tại 1 và is_called false để số đầu là 1.
6. Commit. Không đặt lại sequence ở startup hoặc runtime; không chạy lại backfill trên hồ sơ đã có mã.

Migration mới là đơn vị áp dụng một lần qua lịch sử Prisma; không thiết kế thành script đánh số lại có thể gọi tùy ý. Lệnh migration thất bại phải được kiểm tra theo quy trình hiện hành, không tự dùng reset/resolve. Tạo và khởi tạo sequence mới trong transaction này; không thay trạng thái sequence có sẵn của bảng khác.

## Quan hệ và summary phiên

- `EmailOutbox.registrationId` tiếp tục là FK UUID đến `RegistrationRequest.id`; không đổi cột `email_outbox.registration_id`.
- Unique của `applicantUserId` giữ nguyên: mỗi tài khoản vẫn có cùng hồ sơ khi sửa/gửi lại.
- Các liên kết tài liệu và certificate documentUrl tiếp tục dùng UUID hiện tại.
- Summary nội bộ `SessionUser.registrationRequest` chọn thêm `registrationNumber: bigint`; service chuyển thành `registrationID: string` khi trả public response.
- `registrationRequest: null` vẫn là null, không tạo hồ sơ hoặc cấp số khi đọc phiên.

## Lifecycle

| Thao tác                                  | Trạng thái               | Xử lý mã                                             |
| ----------------------------------------- | ------------------------ | ---------------------------------------------------- |
| Nộp lần đầu                               | Chưa có hồ sơ → PENDING  | Cấp số mới trong insert                              |
| Chỉnh sửa                                 | PENDING → PENDING        | Giữ mã                                               |
| Từ chối                                   | PENDING → REJECTED       | Giữ mã                                               |
| Gửi lại                                   | REJECTED → PENDING       | Giữ mã                                               |
| Phê duyệt                                 | PENDING → APPROVED       | Giữ mã                                               |
| Đọc, đăng nhập, refresh, cập nhật liên hệ | Theo hành vi hiện có     | Không cấp hoặc đổi số                                |
| Ghi thất bại/transaction retry            | Không báo lưu thành công | Có thể mất số; không tái sử dụng để lấp khoảng trống |

Giữ nguyên các điều kiện chuyển trạng thái, kiểm tra tài khoản và quyền hiện tại. `reviewVersion` loại số mới bất biến khỏi projection hash, giữ nguyên các trường bảo vệ nội dung đã có.
