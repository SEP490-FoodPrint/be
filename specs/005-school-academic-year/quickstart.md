# Quickstart: Kiểm chứng bảng năm học

## Prerequisites

- Node.js theo .nvmrc và npm 11; dependencies theo lockfile.
- MIGRATION_TEST_DATABASE_URL phải trỏ database trống có tên foodprint_migration_test hoặc prefix foodprint_migration_test_ trong PostgreSQL local disposable được chọn rõ. Không dùng Azure hoặc database thành viên.
- Tác vụ này chỉ chuẩn bị migration; không chạy db:push, seed hoặc deploy thủ công lên Azure.

## Static and application checks

```bash
npm run prisma:validate
npm run validate
npm run test:unit
```

Validate gồm lint, format, typecheck/build; ghi đúng bước bị chặn. Client generation không áp dụng migration.

## PostgreSQL integration

```bash
npm run test:migrations
```

Kỳ vọng: baseline/history/deploy/drift đều đúng; bảng mới rỗng sau deploy, FK/unique/CHECK hoạt động, holidays mặc định [], giữ dữ liệu School cũ. Harness có thể tạo thêm DB con trong cùng cluster disposable; không reset/drop database hiện hữu.

## Review and release

Spec, plan, tasks và migration cùng PR trên feat/005-school-academic-year vào dev. Spec gate local cần bốn biến môi trường theo be/docs/SPEC_KIT_GUIDE.md; gate đọc HEAD đã commit. CI/CD sau review/merge xử lý migration Azure; tác vụ này không commit/push/deploy.

## Actual verification

Kiểm tra ngày 07/11/2026 trên Windows, Node.js 22.15.0 đang có trên máy (khác runtime chuẩn 24.22.1 của repo/CI), PostgreSQL 18.4 native disposable riêng tại localhost:55439. Không dùng DATABASE_URL Azure cho migration test.

| Kiểm tra                             | Kết quả thực tế                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma validate / generate           | PASS; client sinh tự động, không commit.                                                                                                      |
| `npm run lint`                       | PASS trong lượt `validate`.                                                                                                                   |
| `npm run typecheck`                  | PASS khi chạy riêng.                                                                                                                          |
| `npm run build`                      | PASS khi chạy riêng, gồm Prisma generate và compile.                                                                                          |
| `npm run test:unit`                  | PASS 188/188 test.                                                                                                                            |
| Format các file thay đổi             | PASS cho tests/migrations.test.ts, database/SCHEMA_BASELINE.md và spec 005.                                                                   |
| `npm run validate` toàn working tree | FAIL tại format:check với 277 file cũ; không tự format toàn repo. Typecheck/build được chạy riêng như trên.                                   |
| Migration PostgreSQL                 | PASS 10/10 TAP tests (9 scenario và test cha), gồm ràng buộc bảng mới, baseline, adoption, fresh deploy, history, dữ liệu cũ và Prisma drift. |
| Spec gate evaluator                  | PASS với branch và nội dung working tree gồm file chưa commit; chưa phải lần chạy CI đọc committed HEAD.                                      |
| `git diff --check`                   | PASS.                                                                                                                                         |

Lượt migration đầu ở working tree bị chặn bởi baseline 0_init có CRLF, trong khi manifest và blob Git yêu cầu LF. Không sửa baseline/checksum để vượt lỗi: đã tạo bản sao tạm từ `git archive HEAD`, chép đúng các file thay đổi, dùng dependencies/client hiện có và chạy lại harness trên database trống mới trong cùng cluster disposable. Bản sao không chứa .env. Các migration đã áp dụng trong repository được giữ nguyên.

Test restrict-delete dùng SQLSTATE 23001 (`restrict_violation`) theo kết quả PostgreSQL 18.4; FK tới trường không tồn tại dùng 23503. Lượt cuối không có test fail/skip. Kiểm tra định dạng toàn bản sao cũng còn lỗi các file cũ, nên không báo quality gate tổng hợp PASS.

Migration và model mới chưa được commit/push hoặc áp dụng lên Azure/database thành viên. Cluster tạm được dừng sau kiểm thử; không drop/reset database hay xóa volume.

## Actual verification — release repair FR-008

Bản sửa `fix/005-restore-applied-migration`, base `origin/dev` commit `194ac5c`. Đã xác minh lịch sử Azure bằng transaction chỉ đọc; không chạy deploy/resolve hoặc sửa dữ liệu Azure.

- SQL GVCN khôi phục khớp SHA-256 của migration đã applied: `b1fe455a26a60267d045f2602e61dbdeb9a37ec6367909963f423604cb146f5e`.
- Evaluator trên lịch sử Azure và SQL chuẩn Git LF cộng file khôi phục: PASS, chỉ `20261107000100_school_academic_year` còn pending. Đây là kết quả kiểm tra nội dung dự kiến của bản sửa, chưa phải lần chạy CD trên committed HEAD mới.
- Prisma validate/generate, lint toàn repo, typecheck/build và format các file liên quan: PASS. Runtime local vẫn là Node.js 22.15.0; CI dùng runtime theo .nvmrc. Không báo `validate` tổng hợp PASS vì vấn đề format toàn working tree đã nêu ở trên.
- `npm run test:unit`: PASS 189/189, có regression cho missing history/restored prefix/checksum sai.
- Harness migration trên PostgreSQL 18.4 disposable: PASS 10/10, bao gồm history, fresh deploy, bảo toàn dữ liệu, constraints và Prisma drift với model GVCN đã khôi phục. Dùng bản sao tạm với SQL chuẩn LF như hướng dẫn ở trên, không sửa migration đã applied trong workspace.
- `git diff --check` và Spec gate evaluator trên working tree: PASS. Các thay đổi chưa commit/push; cần merge bản sửa vào dev để CI/CD chạy trên commit chứa migration đã khôi phục, không rerun commit cũ đang thiếu file.
- Cluster PostgreSQL tạm đã tự dừng sau kiểm thử; không xóa database hay volume.
