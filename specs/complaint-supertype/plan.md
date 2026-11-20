# Implementation Plan: Bảng cha khiếu nại và luồng ticket chung (PR1)

**Branch**: `refactor/complaint-supertype` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

## Summary

Tạo bảng cha `complaints` (Class-Table Inheritance, FK tổ hợp `(id, kind)`), `complaint_comments`, `complaint_status_histories`; dựng lại `meal_complaints` và `ingredient_quality_feedback` thành bảng con; gom máy trạng thái ticket vào module dùng chung `src/modules/complaint-ticket/`; đổi API hai module `feedback` và `ingredient-quality-feedback`; thêm runtime tự đóng 48h chạy cùng API.

## Technical Context

- TypeScript strict (CommonJS), Express, Prisma 7 + PostgreSQL, Node test runner.
- Migration mới `20261126000100_complaint_supertype` (sau migration cuối trên `dev`).
- Không thêm dependency.

## Constitution Check

| Nguyên tắc            | Đánh giá                                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Kiến trúc phân lớp | Mỗi module giữ routes/controller/validation/service/repository/2 DTO. Module dùng chung `complaint-ticket` chỉ có repository (truy vấn) và `complaint-ticket.lifecycle.ts` (quy tắc thuần, không truy vấn); service của từng module điều phối. |
| II. Phân quyền        | Không thêm mã quyền; scope lấy từ `AuthPrincipal` qua `resource-access.ts`; thao tác ghi nạp lại actor trong transaction (`withSchoolTransaction` cho phía trường, `authorizationTransaction` + khóa thứ tự cũ cho NCC).                       |
| III. An toàn DB       | Migration mới, có guard bảng rỗng; không chạy trên Azure trong PR này; không seed. CHECK nằm trong SQL.                                                                                                                                        |
| IV. Transaction       | Ghi cha + con + lịch sử + bình luận trong cùng transaction; cập nhật trạng thái bằng `updateMany` có điều kiện. Không dùng cache.                                                                                                              |
| V. HTTP               | Giữ envelope `sendSuccess`/`sendError`; DTO allowlist; Date serialize ISO. Contract đổi theo Q28.                                                                                                                                              |
| VI. Spec-driven       | Spec này thay thế phần liên quan của Spec 012/019 và `supplier-complaint-response` (spec gate chỉ cho sửa thư mục spec của nhánh).                                                                                                             |
| VII. Mã nghiệp vụ     | `complaints.code` UNIQUE NOT NULL; `MC`/`CP` đã đăng ký; cấp bằng `allocateBusinessCode` trong transaction tạo.                                                                                                                                |

## Data Model

```sql
CREATE TYPE complaint_kind AS ENUM ('MEAL','INGREDIENT','AUTHORITY','SYSTEM');
CREATE TYPE complaint_ticket_status AS ENUM ('NEW','IN_PROGRESS','REOPENED','RESOLVED','CLOSED');
CREATE TYPE complaint_close_reason AS ENUM ('SATISFIED','ESCALATED','AUTO_CLOSED');
CREATE TYPE complaint_comment_side AS ENUM ('REQUESTER','HANDLER');
CREATE TYPE complaint_comment_type AS ENUM ('MESSAGE','RESOLUTION','REOPEN_NOTE','ESCALATION_NOTE');
CREATE TYPE complaint_actor_type AS ENUM ('USER','SYSTEM');
```

`complaints`: `id`, `kind`, `code varchar(25)`, `sender_user_id`, `sender_role_code → roles(code)`, `sender_school_id`, `sender_supplier_id`, `sender_commune_food_safety_unit_id`, `title varchar(255)`, `description text`, `status`, `last_resolved_at`, `resolved_count`, `close_reason`, `closed_at`, `closed_by_user_id`, `submitted_at`, `updated_at`; `UNIQUE(id, kind)`.

CHECK: định dạng mã + chữ viết tắt khớp `kind`; `num_nonnulls(sender_*) <= 1`; `btrim(title|description) <> ''`; `resolved_count >= 0`; `status <> 'RESOLVED' OR last_resolved_at IS NOT NULL`; `(status = 'CLOSED') = (close_reason IS NOT NULL AND closed_at IS NOT NULL)`; `close_reason IS NULL OR ((close_reason = 'AUTO_CLOSED') = (closed_by_user_id IS NULL))`; `close_reason IS DISTINCT FROM 'ESCALATED' OR kind = 'MEAL'`.

Index: `(kind, submitted_at DESC, id)`, `(sender_user_id, submitted_at DESC)`, `(status, submitted_at DESC)`, partial `(last_resolved_at) WHERE status = 'RESOLVED'`.

Bảng con: `meal_complaints(id, kind = 'MEAL', school_id, daily_meal_portion_id, complaint_type)`, `ingredient_quality_feedback(id, kind = 'INGREDIENT', delivery_id, ingredient_lot_id)`; `FOREIGN KEY (id, kind) REFERENCES complaints(id, kind) ON DELETE RESTRICT`; CHECK `kind = '<KIND>'`.

`complaint_comments`: `id`, `complaint_id`, `author_user_id`, `author_role_code`, `author_side`, `comment_type`, `content`, `created_at`; CHECK nội dung không rỗng, `RESOLUTION ⇒ HANDLER`, `REOPEN_NOTE|ESCALATION_NOTE ⇒ REQUESTER`; index `(complaint_id, created_at, id)`.

`complaint_status_histories`: `id`, `complaint_id`, `from_status`, `to_status`, `close_reason`, `actor_type`, `actor_user_id`, `actor_role_code`, `created_at`; CHECK `(actor_type = 'SYSTEM') = (actor_user_id IS NULL)`, `(actor_user_id IS NULL) = (actor_role_code IS NULL)`, `(to_status = 'CLOSED') = (close_reason IS NOT NULL)`; index `(complaint_id, created_at, id)`.

## Thiết kế mã

- `src/modules/complaint-ticket/complaint-ticket.lifecycle.ts`: hằng `FEEDBACK_WINDOW_MS = 48h`, `allowedActions(view, row, now)`, `displayStatus`, `hasNewMessage`, `feedbackDeadline`, tiêu đề tự sinh, ánh xạ thao tác → (trạng thái nguồn, đích).
- `src/modules/complaint-ticket/complaint-ticket.repository.ts`: `createComplaint` (cha), `transition` (updateMany có điều kiện + lịch sử), `addComment`, `listComments`, `latestCommentSides`, `findExpiredResolved`, `autoClose`.
- `feedback` (MEAL) và `ingredient-quality-feedback` (INGREDIENT): service gọi lifecycle để kiểm tra vai trò/trạng thái, repository chung để ghi; response DTO thêm trường ticket.
- `src/utils/complaint-auto-close-runtime.ts`: `setInterval` 5 phút (tiêm được để test), không chạy chồng; `server.ts` khởi động/dừng cùng email runtime. Kế hoạch cũ đề xuất BullMQ repeatable job; chọn interval trong tiến trình vì thao tác đóng là cập nhật có điều kiện, idempotent khi nhiều tiến trình cùng chạy, và không cần thêm hàng đợi.

## Rollback

Migration đã áp dụng là bất biến. Rollback = migration tiến mới dựng lại bảng cũ (chỉ khả thi khi chưa phát sinh dữ liệu ticket, vì thông tin bình luận/lịch sử không có chỗ trong bảng cũ). Code PR1 và migration deploy cùng lúc qua CD `azure-dev`; guard bảng rỗng phải được xác nhận trên `azure-dev` trước khi merge.

## Complexity Tracking

Không có vi phạm hiến chương.
