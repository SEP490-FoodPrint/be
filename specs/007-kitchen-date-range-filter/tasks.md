# Tasks: Commit và đồng bộ bộ lọc ngày mẻ nấu

**Input**: [spec.md](spec.md), [plan.md](plan.md), hai file kitchen đã được người dùng xác nhận hoàn tất.

## Setup

- [x] T001 Đọc và xác nhận diff ở `src/modules/kitchen/kitchen.service.ts` và `src/modules/kitchen/kitchen.validation.ts`; phân biệt các file role chỉ khác xuống dòng.
- [x] T002 Tạo bộ spec `specs/007-kitchen-date-range-filter/` cho nhánh cùng số; giữ bản dự phòng dev trước đồng bộ.

## US1 — Khoảng ngày danh sách

- [x] T003 [US1] Ghi nhận startDate/endDate optional trong `src/modules/kitchen/kitchen.validation.ts` theo code đã có.
- [x] T004 [US1] Ghi nhận gte/lte và ưu tiên khoảng so với date trong `src/modules/kitchen/kitchen.service.ts` theo code đã có; không viết thêm logic.

## Verification

- [x] T005 Chạy lint/format hai file và typecheck; kết quả PASS trước khi lưu commit.
- [x] T006 Chạy build và unit tests hiện hữu trong `package.json`, ghi kết quả vào `specs/007-kitchen-date-range-filter/plan.md`.

## Dependencies

T001 → T002 → T003/T004 → T005/T006. Sau kiểm tra, lưu spec trước code; giữ hooks và chuẩn Conventional Commits. Pull/rebase chỉ khi working tree sạch; đây là thao tác đồng bộ, không phải thay đổi hành vi tính năng.
