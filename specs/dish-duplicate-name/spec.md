# Feature Specification: Báo rõ khi tạo món trùng tên

**Feature Branch**: `fix/dish-duplicate-name`

**Created**: 2026-11-26

**Status**: Implemented

**Input**: Tạo món ăn trùng tên đang báo lỗi như lỗi hệ thống; cần thông báo rõ là trùng tên.

## Bối cảnh

`Dish` có ràng buộc duy nhất `(schoolId, name)`. Khi lưu món trùng tên, lỗi Prisma `P2002` xảy ra trong transaction phân quyền nên bị đổi thành 503 "Không thể xử lý phân quyền. Vui lòng thử lại sau.".

## Clarifications

### Session 2026-11-26

- So tên không phân biệt hoa thường trong cùng trường; sửa món mà giữ nguyên tên của chính nó thì không bị chặn.
- Món đã ngừng dùng vẫn giữ tên trong ràng buộc duy nhất nên cũng bị tính là trùng.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Biết ngay tên món đã có (Priority: P1)

Cán bộ dinh dưỡng tạo hoặc đổi tên món sang tên đã có và nhận thông báo đặt tên khác.

**Acceptance Scenarios**:

1. **Given** trường đã có món "Canh chua", **When** tạo món "canh chua", **Then** API trả 409 "Tên món đã có. Đặt tên khác.".
2. **Given** món "Canh chua" đang được sửa, **When** lưu lại với tên "Canh chua", **Then** lưu thành công.
3. **Given** hai yêu cầu cùng tạo một tên món, **When** yêu cầu thứ hai vướng ràng buộc duy nhất, **Then** API trả 409 cùng thông báo thay vì 503.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Lưu món MUST từ chối (409) khi tên, không phân biệt hoa thường, trùng với món khác của cùng trường.
- **FR-002**: Lỗi ràng buộc duy nhất khi ghi món MUST trả 409 "Tên món đã có. Đặt tên khác.".
- **FR-003**: Món trùng tên với món đã ngừng dùng MUST nhận thông báo riêng "Tên món trùng với món đã ngừng dùng. Đặt tên khác.".

## Success Criteria

- **SC-001**: Unit test trùng tên đạt; ESLint, `tsc --noEmit`, Prettier và `npm run test:unit` đạt.
