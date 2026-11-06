# Tasks: Nền tảng lịch năm học toàn trường

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contract](contracts/storage.md).

**Tests**: Spec yêu cầu nghiệm thu ràng buộc và bảo toàn dữ liệu bằng PostgreSQL thật. Mở rộng harness migration hiện có, không thêm framework hoặc script unit mới.

## Phase 1: Setup

- [x] T001 Đối chiếu `AGENTS.md`, `.specify/memory/constitution.md` và schema hiện hành; tạo bộ spec tại `specs/005-school-academic-year/` trên nhánh cùng số.
- [x] T002 Ghi quyết định một bảng, CHECK JSON tối thiểu, phạm vi storage và điều kiện runtime/test trong `specs/005-school-academic-year/plan.md` và `research.md`.

## Phase 2: Foundational

- [x] T003 Chuẩn bị PostgreSQL 18 disposable riêng, xác lập MIGRATION_TEST_DATABASE_URL và ghi prerequisite trong `specs/005-school-academic-year/quickstart.md`; không dùng Azure hoặc DB thành viên.

## Phase 3: US1 — Khoảng năm học của trường

**Goal**: Lưu năm học độc lập theo trường, unique nhãn và ngày hợp lệ.

**Independent Test**: Nhiều trường/năm được lưu; trùng nhãn trong cùng trường, ngày đảo, nhãn trắng và FK sai bị từ chối.

- [x] T004 [US1] Bổ sung kiểm thử unique/FK/ngày/nhãn và cập nhật timestamp trong `tests/migrations.test.ts`.
- [x] T005 [US1] Thêm SchoolAcademicYear và relation School.academicYears vào `prisma/schema.prisma`; thêm migration `prisma/migrations/20261107000100_school_academic_year/migration.sql` với đúng một bảng/index/FK/CHECK.

## Phase 4: US2 — Danh sách ngày nghỉ

**Goal**: Lưu JSON array ngày nghỉ/lý do cùng năm học.

**Independent Test**: Default [], roundtrip tiếng Việt, SQL NULL và JSON sai loại bị từ chối.

- [x] T006 [US2] Bổ sung kiểm thử default/roundtrip/JSON array/null trong `tests/migrations.test.ts`; đối chiếu default/CHECK và hợp đồng `specs/005-school-academic-year/contracts/storage.md`.

## Phase 5: US3 — Nâng cấp giữ dữ liệu

**Goal**: Chỉ thêm cấu trúc rỗng, giữ dữ liệu cũ và tương thích ứng dụng.

**Independent Test**: Harness deploy đầy đủ migration, kiểm tra history/drift, trường cũ không đổi và bảng mới chưa có seed.

- [x] T007 [US3] Kiểm tra bảng rỗng/dữ liệu School cũ, restrict delete và chạy harness `tests/migrations.test.ts` trên PostgreSQL disposable.
- [x] T008 [US3] Ghi migration, giới hạn JSON validation, tương thích và tình trạng deployment vào `database/SCHEMA_BASELINE.md`.

## Phase 6: Verification and polish

- [x] T009 Chạy Prisma validate/generate, lint/format, typecheck/build, unit tests; kiểm tra Spec gate với artifacts trong `specs/005-school-academic-year/` và ghi kết quả thực tế vào `quickstart.md`.
- [x] T010 Review diff, migration cũ bất biến, không có generated output/credential và cập nhật trạng thái `specs/005-school-academic-year/tasks.md`.

**Verification note**: Task kiểm tra đã thực hiện đầy đủ; format toàn repo còn FAIL do các file cũ. Không coi việc đánh dấu task là quality gate tổng hợp PASS. Chi tiết và runtime thực tế tại [quickstart.md](quickstart.md).

## Dependencies & Execution Order

T001 → T002 → T003; T004 viết trước T005. T006 bổ sung trên cùng file test sau T004. T005/T006 → T007. T008 có thể làm song song với chuẩn bị chạy test sau khi SQL đã chốt; T009/T010 hoàn tất sau các story. Không chạy song song migration lên cùng database hoặc hai lượt generate client.

## Parallel Opportunities

Sau khi migration đã chốt, cập nhật `database/SCHEMA_BASELINE.md` độc lập với đọc kết quả test. Trong verification, unit tests và kiểm tra format/lint có thể chạy song song; client generation phải xong trước typecheck/build.

## Implementation Strategy

Hoàn thành foundation và model/migration (US1), kiểm chứng JSON (US2), chạy test upgrade đầy đủ (US3), rồi quality checks. MVP là toàn bộ thay đổi storage trong spec; không mở rộng sang API, FE, calendar business validation hoặc deployment.

## Phase 7: Release repair — lịch sử Azure đã đi trước Git

- [x] T011 [US3] Đối chiếu lịch sử Azure trong transaction chỉ đọc và xác minh checksum SQL gốc từ nhánh GVCN; ghi bằng chứng/phạm vi FR-008 vào `specs/005-school-academic-year/spec.md` và `plan.md`.
- [x] T012 [US3] Thêm regression case vào `tests/migration-deployment.test.ts` cho thiếu migration GVCN, phục hồi prefix và từ chối checksum sai.
- [x] T013 [US3] Khôi phục nguyên SQL đã applied tại `prisma/migrations/20261107000100_class_homeroom_assignments/migration.sql` và model/relation/partial indexes tương ứng trong `prisma/schema.prisma` từ nguồn đã kiểm chứng.
- [x] T014 [US3] Kiểm tra prefix Azure chỉ đọc, migration/history/drift trên PostgreSQL disposable; cập nhật `database/SCHEMA_BASELINE.md` và `specs/005-school-academic-year/quickstart.md`.
- [x] T015 Chạy Prisma validate/generate, lint/format file liên quan, typecheck/build và unit tests; review diff/checksum/Spec gate, ghi kết quả vào `specs/005-school-academic-year/quickstart.md`.

T011 → T012 → T013 → T014/T015. Không thay đổi guard để bỏ qua lịch sử dư hoặc chỉnh database từ CI bị lỗi.
