# Implementation Plan: Triển khai lại migration gỡ khiếu nại System Admin

**Branch**: `fix/cd-remove-system-complaints` | **Spec**: [spec.md](./spec.md)

## Technical Context

PostgreSQL trên Azure, `prisma migrate deploy` trong `.github/workflows/cd.yml`. Không đổi schema Prisma, không đổi code ứng dụng.

## Thiết kế

1. `prisma/migrations/20261209000100_remove_system_complaints/migration.sql`: tăng `lock_timeout`/`statement_timeout`, khóa `ACCESS EXCLUSIVE` hai bảng bị DROP/ALTER ngay đầu, giữ nguyên phần còn lại (FR-001, FR-002).
2. Operator: xác nhận chỉ đọc rằng migration chưa áp dụng gì, chạy `migrate resolve --rolled-back` trên Azure, merge PR để CD chạy lại (FR-003).

## Constitution Check

Migration chưa hoàn tất trên Azure nên được sửa trước lần áp dụng thành công đầu tiên; không seed, reset hay `db push`.
