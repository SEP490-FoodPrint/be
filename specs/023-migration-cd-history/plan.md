# Plan: Sửa kiểm tra lịch sử CD

**Branch**: `fix/023-migration-cd-history`

Node 24, TypeScript strict/CommonJS, Prisma 7, Node test runner hiện có. Không đổi schema hoặc thêm dependency.

Giữ guard Azure target và transaction chỉ đọc. Thay giả định applied-prefix bằng so khớp từng migration active theo tên với catalog file; kiểm tra baseline, duplicate, trạng thái và checksum trước khi trả danh sách pending theo thứ tự tên. Giữ chặn database đi trước Git vì mọi tên đã áp dụng đều phải tồn tại trong catalog.

Khôi phục đúng một LF dư trong SQL drop_sample_storage_units_brand; đóng băng checksum bằng regression đọc byte file, tránh thay nội dung nghiệp vụ. Mô phỏng history Azure trong tests/migrations.test.ts bằng directory migration tạm, trước tiên bỏ hai migration đang chờ rồi thêm lại; không sửa directory migration thật để dựng fixture.

## Constitution check

- Logic kiểm tra deployment nằm trong utility hiện có; không sửa API hoặc DTO.
- Không đổi role, permission hoặc organization scope.
- SQL áp dụng bất biến được khôi phục về checksum đã quan sát, không cập nhật database/history.
- Không đổi transaction isolation, deployment target, CD authorization hoặc seed policy.
- Có spec/plan/tasks cùng số 023; branch từ origin/dev mới nhất.

## Kiểm chứng

Viết unit regression trước logic; kiểm tra checksum và các lỗi bảo vệ. Chạy unit, prisma validate, lint/format/typecheck/build. Migration test chỉ trên PostgreSQL local disposable được cho phép. Sau bản sửa, so khớp lịch sử Azure chỉ đọc với file của worktree; đây không phải deploy hoặc bằng chứng rollout thành công.
