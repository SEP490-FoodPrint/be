# Tasks: Sửa lịch sử CD

- [x] T001 Đối chiếu origin/dev với lịch sử Azure chỉ đọc; xác nhận pending merge muộn và một checksum sai.
- [x] T002 Viết regression pending merge muộn, baseline/duplicate/missing/unfinished/checksum và checksum SQL trong tests/migration-deployment.test.ts; xác nhận fail trước sửa.
- [x] T003 Sửa src/utils/migration-deployment.ts so khớp history theo tên và giữ toàn bộ guard bảo vệ.
- [x] T004 Khôi phục byte SQL đã applied và cập nhật database/SCHEMA_BASELINE.md.
- [x] T005 Bổ sung và chạy upgrade/deploy migration merge muộn trên PostgreSQL disposable trong tests/migrations.test.ts.
- [x] T006 Chạy unit, schema validate, validate/build và Spec gate; ghi bằng chứng thực trong quickstart.md.
- [x] T007 Chạy kiểm chứng Azure chỉ đọc sau sửa, xác nhận đúng hai pending và không đổi database; không tự deploy/commit/push.
