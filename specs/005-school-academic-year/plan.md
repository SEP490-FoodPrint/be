# Implementation Plan: Nền tảng lịch năm học toàn trường

**Branch**: `feat/005-school-academic-year` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: [spec.md](spec.md), yêu cầu thêm đúng một bảng đã được người dùng xác nhận.

## Summary

Thêm model SchoolAcademicYear ánh xạ `foodprint.school_academic_years`, quan hệ School 1:N, mốc ngày dạng DATE và `holidays` JSONB array mặc định rỗng. Migration mới chỉ thêm bảng/index/FK/CHECK; không seed/backfill hoặc sửa các luồng nghiệp vụ. Bổ sung kiểm thử ràng buộc vào harness migration hiện có.

## Technical Context

- **Language/Version**: TypeScript strict/CommonJS; Node.js theo `.nvmrc` (24.22.1), npm 11. Máy hiện có Node 22.15.0; ghi rõ runtime thực tế khi kiểm tra.
- **Dependencies**: Prisma CLI/Client 7.10.1, pg, tsx; không thêm thư viện.
- **Storage**: PostgreSQL 18, schema foodprint; UUID `gen_random_uuid()`, DATE, JSONB và timestamptz(6).
- **Testing**: Node test runner; mở rộng `tests/migrations.test.ts`, Prisma validate/generate, lint/format, typecheck/build và unit tests hiện có.
- **Target Platform / Project Type**: Backend API hiện hữu; thay đổi lần này là cấu trúc persistence nội bộ.
- **Performance Goals**: Tra cấu hình theo schoolId/academicYear bằng unique index; không thêm truy vấn hoặc công việc startup vào đường HTTP hiện có.
- **Constraints**: Đúng một bảng mới, không custom function/trigger, không DML vào dữ liệu cũ, không tự sinh lịch, không sửa migration đã áp dụng.
- **Scale/Scope**: Mỗi trường có nhiều năm học; mỗi trường/nhãn năm có một bản ghi. Không siết định dạng nhãn hoặc chặn khoảng chồng lấn ngoài yêu cầu.

## Constitution Check

| Nguyên tắc            | Trước nghiên cứu | Sau thiết kế | Đáp ứng                                                                                            |
| --------------------- | ---------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| I. Phân lớp           | PASS             | PASS         | Không thêm endpoint hay code nghiệp vụ; không tạo DTO/repository trống.                            |
| II. Phân quyền        | PASS             | PASS         | Không thêm quyền hoặc mở truy cập; schoolId là FK persistence, không phải quyền do client tự chọn. |
| III. An toàn DB       | PASS             | PASS         | Người dùng cho phép thêm một bảng; chỉ chuẩn bị migration, kiểm thử trên cluster disposable riêng. |
| IV. Transaction/cache | PASS             | PASS         | SQL BEGIN/COMMIT, không cache hoặc transaction nghiệp vụ mới.                                      |
| V. HTTP/serialization | PASS             | PASS         | Không thay hợp đồng HTTP hoặc safe projection hiện hữu.                                            |
| VI. Spec-driven       | PASS             | PASS         | Spec 005, plan và tasks đi cùng thay đổi trên nhánh feat/005-school-academic-year.                 |

Không có ngoại lệ hiến chương.

## Project Structure

```text
specs/005-school-academic-year/
  spec.md
  plan.md
  research.md
  data-model.md
  contracts/storage.md
  quickstart.md
  tasks.md
  checklists/requirements.md
prisma/schema.prisma
prisma/migrations/20261107000100_school_academic_year/migration.sql
tests/migrations.test.ts
database/SCHEMA_BASELINE.md
```

**Structure Decision**: Giữ cấu trúc repo; thêm relation `School.academicYears` và model mới. Client/dist chỉ sinh bằng công cụ, không commit.

## Design and Validation

- UUID primary key; schoolId FK `ON DELETE RESTRICT ON UPDATE NO ACTION`; unique `(school_id, academic_year)` đồng thời hỗ trợ tìm theo trường.
- `academicYear` VARCHAR(30), CHECK `length(btrim(academic_year)) > 0`; ngày bắt đầu không sau ngày kết thúc.
- `holidays` JSONB NOT NULL DEFAULT `[]`, CHECK `jsonb_typeof(holidays) = 'array'`. SQL chỉ bảo đảm container; hợp đồng từng mục `{date, reason}` và kiểm tra sâu phải do service/validation thực hiện khi có API, không tuyên bố đã có chức năng nhập lịch.
- `createdAt`, `updatedAt` có default hiện hành; mapped updatedAt dùng Prisma @updatedAt. Raw SQL cập nhật phải đặt updated_at tường minh.
- Test migration: mặc định JSON/timestamps/UUID, nhiều năm/trường, roundtrip lý do tiếng Việt, unique/FK/restrict-delete, nhãn trắng, ngày đảo, JSON sai loại/null; xác nhận bảng ban đầu rỗng và dữ liệu School cũ giữ nguyên qua migration.
- Không chạy migration trên DATABASE_URL Azure. Test chỉ dùng MIGRATION_TEST_DATABASE_URL trỏ cluster PostgreSQL 18 mới tạo trong thư mục tạm dành riêng tác vụ; không đụng cluster/container khác.

## Release and Rollback

Review/merge PR vào dev; CI migration harness kiểm tra baseline/history/drift, CD đã duyệt áp pending migration lên Azure. Không push/deploy trong tác vụ này. Ứng dụng cũ tương thích vì không đọc bảng mới. Rollback ứng dụng giữ bảng/dữ liệu; không xóa bảng chứa lịch đã nhập. API, BGH permissions, UI, tích hợp lịch nghỉ với menu/suất ăn là tác vụ tiếp theo.

## Complexity Tracking

Không phát sinh ngoại lệ hoặc dependency mới.

## Release repair: Khôi phục migration đã applied

- Phạm vi FR-008 trên nhánh `fix/005-restore-applied-migration`: khôi phục nguyên byte SQL GVCN đã xác minh bằng checksum Azure, đặt đúng tên `20261107000100_class_homeroom_assignments`.
- Nguồn: `origin/feat/bgh-menu-approval-class-assignment`, file migration tên cũ `20261102000200_class_homeroom_assignments`. Không merge cả nhánh; không đổi bất kỳ migration đang có hoặc dòng lịch sử Azure.
- Đồng bộ model `ClassHomeroomAssignment` và relation Class/User từ cùng nguồn; giữ hai partial indexes và CHECK lifecycle trong SQL để Prisma drift không coi bảng đang có là dư.
- Thêm regression test: thiếu migration GVCN thì guard chặn; có file khôi phục đúng checksum thì chỉ năm học còn pending; đổi checksum vẫn bị chặn. Test migration local tiếp tục bao phủ deploy/history/drift.
- Xác minh lịch sử Azure bằng transaction chỉ đọc và checksum Git chuẩn LF; không chạy DDL, deploy/resolve hoặc sửa `_prisma_migrations` trên Azure. Constitution Check I–VI tiếp tục PASS: không đổi business API/quyền, SQL applied được khôi phục nguyên bản, các thay đổi cùng spec 005.
