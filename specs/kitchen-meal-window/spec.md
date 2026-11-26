# Feature Specification: Chặn xử lý lô nấu ngoài khung giờ bữa

**Feature Branch**: `feat/kitchen-meal-window`

**Created**: 2026-11-26

**Status**: Implemented

**Input**: Vào khung giờ bữa xế thì không được nấu bữa trưa, và ngược lại.

## Clarifications

### Session 2026-11-26

- Khung giờ dựa trên giờ bữa trưa BGH cấu hình (`School.lunchTime`), theo giờ Việt Nam (UTC+7): tới hết phút giờ bữa trưa là khung bữa trưa, sau đó là khung bữa xế.
- Chặn cứng, không có thời gian ân hạn: lô bữa trưa xong muộn sau giờ bữa trưa cũng không ghi nhận được.
- Chặn cả xác nhận nấu và ghi nhận nấu xong, vì lô do đợt giao tạo đã ở trạng thái `CONFIRMED` và bếp chỉ ghi nhận nấu xong.
- Trường chưa cấu hình giờ bữa trưa thì không chặn.
- FE chỉ hiện bữa đang trong khung giờ; BE là nơi chặn chính thức.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Không xử lý nhầm bữa (Priority: P1)

Nhân viên bếp chỉ xác nhận nấu và ghi nhận nấu xong lô của bữa đang trong khung giờ.

**Acceptance Scenarios**:

1. **Given** giờ bữa trưa 11:30 và hiện là 10:00, **When** xử lý lô bữa xế, **Then** API trả 409 "Chưa tới khung giờ bữa xế (sau 11:30).".
2. **Given** giờ bữa trưa 11:30 và hiện là 11:31, **When** xử lý lô bữa trưa, **Then** API trả 409 "Đã qua giờ bữa trưa (11:30). Chỉ xử lý lô bữa xế.".
3. **Given** trường chưa cấu hình giờ bữa trưa, **When** xử lý lô bất kỳ bữa nào, **Then** không bị chặn theo khung giờ.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `POST /cooking-batches/:id/confirm` với lô `UNCONFIRMED` MUST từ chối (409) khi bữa của lô không phải bữa đang trong khung giờ.
- **FR-002**: `POST /cooking-batches/:id/complete` với lô `CONFIRMED` MUST từ chối (409) theo cùng quy tắc.
- **FR-003**: Gọi lại cho lô đã xác nhận hoặc đã hoàn thành MUST giữ hành vi trả kết quả cũ, không bị chặn theo khung giờ.
- **FR-004**: Trường chưa cấu hình giờ bữa trưa MUST không bị chặn.

## Success Criteria

- **SC-001**: Unit test khung giờ (trước, đúng, sau giờ bữa trưa; chưa cấu hình) đạt; ESLint, `tsc --noEmit`, Prettier và `npm run test:unit` đạt.
- **SC-002**: Test tích hợp xử lý lô cố định thời điểm trong khung giờ bữa trưa và tiếp tục đạt trên CI.
