# Implementation Plan: Duyệt thực đơn theo khối

**Branch**: `feat/menu-approval-by-grade` | **Spec**: [spec.md](spec.md)

## Thay đổi

- `menu-approval.repository.ts`: include `User { fullName }`.
- `menu-approval.service.ts`: proposer là tên người tạo, nhãn "Nhân viên Dinh dưỡng".
- Test: `tests/menu-weekly-approval.test.ts`.

## Constitution Check

- I. Phân lớp: Pass. II. Scope theo principal: Pass. III. Không DDL: Pass.
- IV. Chỉ đọc: Pass. V. DTO không đổi: Pass. VI. Spec cùng PR: Pass.
