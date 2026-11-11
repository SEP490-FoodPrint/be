# Kế hoạch kỹ thuật

GET trả `date`, `status`, `message`, `totals`, `meals`, `missingSampleBatches`, `batches`, `demands` và `revision`. PUT nhận revision và danh sách lô chỉnh được kèm nhu cầu lớp và số suất. Hai thao tác dùng envelope hiện có.

## Constitution Check

1. Module phân lớp và DTO từ Zod, repository quản lý Prisma.
2. Quyền view/update/create theo principal và truy vấn giới hạn trường.
3. Schema hiện tại, fixture chỉ chạy trên PostgreSQL local được chỉ định.
4. Đọc snapshot và ghi theo transaction chung của trường, không thêm cache.
5. Envelope chung, DTO theo danh sách trường, serialize ngày rõ ràng.
6. Spec, plan, tasks cùng PR và kiểm bằng Spec gate.

Dùng cooking batch làm đơn vị FE. Mỗi phân bổ được ghi với cùng số suất trên mỗi món bắt buộc. Phiên bản băm snapshot sắp xếp ổn định. Các phân bổ lịch sử chưa khớp cần đối soát. Chạy kiểm tra BE, FE và kiểm thử PostgreSQL local.
