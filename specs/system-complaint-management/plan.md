# Implementation Plan: Khiếu nại gửi System Admin theo luồng ticket (C06, PR2)

**Branch**: `feat/system-complaint-management` | **Spec**: [spec.md](./spec.md)

## Summary

Thêm bảng con `system_complaints` (kind `SYSTEM`, cột `category`) và module `system-complaint` dùng lại lõi `complaint-ticket` của PR1. Mã `FP-SC-` Feistel; ba quyền mới; API `/api/system-complaints`.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL. Tái sử dụng `complaint-ticket.lifecycle/repository/service/validation`, `allocateBusinessCode`, `authorizationTransaction` + `loadPrincipal`. Job tự đóng của PR1 không lọc kind nên tự áp dụng cho C06.

## Constitution Check

- Spec-driven: spec/plan/tasks trong `specs/system-complaint-management/`.
- Module đủ lớp routes/controller/validation/service/repository/request DTO/response DTO; service không dựng truy vấn Prisma.
- Mọi list endpoint có `requireResource("system-complaint")` + scope trong `resource-access.ts`.
- Migration mới, không sửa migration đã áp dụng; CHECK trong SQL; không function/trigger.
- Mã nghiệp vụ `FP-SC-NNNNN` đăng ký một lần trong `business-code.ts`.
- Không seed/không thao tác DB từ xa; CD triển khai migration sau merge.

## Data Model

Migration `prisma/migrations/20261127000100_system_complaints/migration.sql`:

- `CREATE TYPE foodprint.system_complaint_category AS ENUM ('ACCOUNT','PERMISSION','DATA','TECHNICAL','OTHER')`.
- `system_complaints(id uuid PK, kind complaint_kind NOT NULL DEFAULT 'SYSTEM', category system_complaint_category NOT NULL)`, CHECK `system_complaints_kind (kind = 'SYSTEM')`, `uq_system_complaints_id_kind`, FK `system_complaints_id_kind_fkey (id, kind) → complaints(id, kind) ON DELETE RESTRICT`.
- Bảng cha đã có CHECK `complaints_code_kind` cho `FP-SC-%` và `complaints_escalated_kind` (chỉ MEAL được ESCALATED) từ PR1 — không đổi.

Prisma: model `SystemComplaint`, enum `SystemComplaintCategory`, quan hệ `Complaint.systemComplaint`.

## Thiết kế mã

- `business-code.ts`: `SC: "khiếu nại gửi hệ thống"`.
- `complaint-ticket.lifecycle.ts`: `SYSTEM_COMPLAINT_CATEGORIES`, `systemComplaintTitle(category)`.
- `permission-catalog.ts`: 3 quyền + grant (submit cho 11 vai trò; view/respond cho `SYSTEM_ADMIN`).
- `resource-access.ts`: `RESOURCE_PERMISSIONS["system-complaint"] = ["system_complaint.view", "system_complaint.submit"]`, `listScopes["system-complaint"]`.
- `src/modules/system-complaint/`: routes (mount `/system-complaints`), controller, validation (list query, create, id, ticket bodies), request/response DTO, repository (`list`, `findOne`, `findTicketTarget`, `create` nested child), service (`getAll`, `getOne`, `create`, `accept`, `comment`, `resolve`, `satisfy`, `reopen`; khung `act` nạp lại actor trong `authorizationTransaction`).
- Người xem: người gửi ⇒ `REQUESTER`; System Admin có `respond` ⇒ `HANDLER`; còn lại ⇒ `OBSERVER`.

## Kiểm thử

- Unit `tests/system-complaint.test.ts` (thêm vào `test:unit`): validation, scope, tiêu đề, ánh xạ hai lớp trạng thái, chặn System Admin gửi, catalog grant.
- Integration `tests/authorization.integration.test.ts`: luồng đầy đủ trên DB tạm (gửi từ trường/NCC, phạm vi đọc, tiếp nhận/đồng thời, resolve, satisfy, quyền chỉ xem).
- `tests/migrations.test.ts`: CHECK kind và FK bảng con; parity `migrate diff` đã có.

## Rollback

Migration chỉ thêm bảng/enum mới. Rollback thủ công (có ủy quyền) khi chưa có dữ liệu: `DROP TABLE system_complaints; DROP TYPE system_complaint_category;` và xóa dòng `complaints` kind SYSTEM nếu có, sau đó `migrate resolve --rolled-back`.

## Complexity Tracking

Không có vi phạm hiến chương.
