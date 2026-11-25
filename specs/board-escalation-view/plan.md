# Implementation Plan: Ban Giám hiệu không xem thông tin leo thang ATTP

**Branch**: `fix/board-escalation-view` | **Spec**: [spec.md](./spec.md)

## Technical Context

TypeScript strict, Express, Prisma. Không đổi schema, không migration.

## Thiết kế

1. `src/utils/resource-access.ts`: nhánh `authority-complaint` ném `403` cho `SCHOOL_ADMINISTRATION` và `SCHOOL_MANAGEMENT_BOARD`; vai trò trường còn lại giữ `senderUserId = actor`.
2. `src/constants/permission-catalog.ts`: bỏ grant `authority_complaint.view` của BGH.
3. `authority-complaint.service.ts`: mọi danh sách phía trường là danh sách của người gửi, nên `ticketStatusFilter(status, orgType === SCHOOL)`.
4. `feedback.service.ts`: chỉ trả `escalatedAuthorityComplaint` khi `row.senderUserId === principal.id`.
5. Cập nhật test unit, test tích hợp phân quyền và tài liệu.

## Constitution Check

Không thêm quyền, không đổi envelope; phạm vi vẫn suy từ `AuthPrincipal`.
