# Implementation Plan: Commit bộ lọc khoảng ngày mẻ nấu

**Branch**: `feat/007-kitchen-date-range-filter` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

## Summary

Ghi nhận và commit đúng diff đã được người dùng xác nhận: kitchen.validation.ts nhận startDate/endDate; kitchen.service.ts thêm bộ lọc MenuDay.menuDate gte/lte, giữ date cũ khi không có khoảng. Sau commit, đồng bộ origin/dev bằng rebase giữ local history và giải quyết xung đột nếu có.

## Technical Context

- TypeScript strict/CommonJS, Prisma và Express hiện có; không dependency/schema/migration mới.
- Target: danh sách kitchen hiện tại, không thay hợp đồng permission hoặc tenant ownership.
- Máy đang dùng Node.js 22.15.0; runtime chuẩn của repo/CI theo .nvmrc.
- Kiểm tra: ESLint/Prettier đúng file thay đổi, typecheck, build và test:unit hiện có. Không thêm test framework hoặc test chỉ lặp lại biểu thức query.

## Constitution Check

| Nguyên tắc            | Áp dụng                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| I. Kiến trúc          | Chỉ ghi nhận code người dùng đã hoàn tất trong module legacy; không mở rộng thành refactor kitchen ngoài yêu cầu commit. |
| II. Phân quyền        | Giữ nguyên scope/quyền và các bộ lọc khác.                                                                               |
| III. Database         | Không schema, migration hoặc ghi database.                                                                               |
| IV. Transaction/cache | Không thay đổi transaction, cache hoặc rate limit.                                                                       |
| V. HTTP               | Giữ response, chỉ thêm hai query params optional như diff đã xác nhận.                                                   |
| VI. Spec-driven       | Spec/plan/tasks 007 cùng code trên feat/007-kitchen-date-range-filter.                                                   |

## Project Structure

```text
specs/007-kitchen-date-range-filter/{spec.md,plan.md,tasks.md}
src/modules/kitchen/kitchen.validation.ts
src/modules/kitchen/kitchen.service.ts
```

## Verification and Integration

Trước commit, kiểm tra diff không có file mới từ phiên khác ngoài phần đã xác nhận; không sửa các commit đổi role đã có. Commit tài liệu trước, code sau bằng Conventional Commits và giữ hooks. Đồng bộ dev mới nhất sau khi working tree sạch; giữ bản dự phòng dev-5e519bf đã tạo. Nếu Git phát hiện xung đột, kết hợp cả logic local và code incoming, không chọn một phía toàn bộ file.

## Complexity Tracking

Tác vụ chỉ lưu code đã được user xác nhận; kiến trúc query trong service của kitchen là cấu trúc legacy hiện có. Việc chuyển module sang repository/DTO riêng nằm ngoài yêu cầu commit, không tự bổ sung logic hoặc đổi contract để xử lý việc đó.

## Verification before commit

Ngày 08/11/2026, trước đồng bộ dev: typecheck PASS, build PASS, lint/Prettier hai file kitchen và định dạng spec PASS, test:unit PASS 189/189, git diff --check PASS. Chạy trên Node.js 22.15.0 hiện có; runtime chuẩn CI theo .nvmrc. Không báo validate toàn repo PASS vì chỉ kiểm tra định dạng trong phạm vi các file commit.
