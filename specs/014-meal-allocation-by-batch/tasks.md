# Tasks

- [x] T001 Thay hợp đồng, router và module phân bổ theo FR-001 đến FR-004.
- [x] T002 Tích hợp FE và trạng thái khóa theo FR-005.
- [x] T003 Chuẩn bị fixture local và kiểm thử theo FR-006.
- [x] T004 Chạy kiểm tra BE, FE và Spec gate.

## Kết quả kiểm tra

- BE build, typecheck và Prettier trên các file thay đổi đã qua.
- Suite unit có 273 test qua. Suite phân quyền và fixture trên PostgreSQL local có 37 test qua.
- Kiểm tra Spec gate trên nhánh và tập thay đổi trong working tree đạt.
- FE build và kiểm tra Chrome ở vùng nội dung 390 px đã qua. Chrome dùng response giả lập để kiểm giao diện khóa, link và một lần gửi PUT.
- `npm run validate` dừng ở bước format toàn repo do các file sẵn có ngoài phạm vi. Build và typecheck được chạy riêng.
