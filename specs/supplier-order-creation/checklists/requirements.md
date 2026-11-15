# Specification Quality Checklist: Tạo đơn giao hàng có nguồn cung và QR truy xuất

**Purpose**: Kiểm tra chất lượng đặc tả trước khi lập kế hoạch.

**Created**: 2026-11-14

**Updated**: 2026-11-15 — sửa đổi nguồn cung, QR, mã theo nhà cung cấp và vòng đời giao hàng.

**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Rà soát bản sửa đổi: đạt 16/16 tiêu chí. Đã ghi nhận đủ Q1 = B (dãy mã theo nhà cung cấp), Q2 = B (QR công khai giới hạn), Q3 = A (giữ giới hạn hủy ở lần từ chối thứ ba).
- Story 1–3 và FR-001–FR-013 giữ nền tảng hai cách tạo, phạm vi tổ chức, toàn bộ lượng nguồn và chống trùng, đồng thời cập nhật trạng thái bắt đầu và thông tin giao bắt buộc.
- Story 4, FR-014–FR-018 và SC-006–SC-007 bao quát nguồn/QR mỗi dòng, dãy mã riêng, lấy lại nhãn, truy xuất công khai có danh sách trường cho phép và giữ nguồn lịch sử.
- Story 5, FR-019–FR-022 và SC-008–SC-010 xác định đủ bốn bên đạt mới hoàn thành/nhập kho đúng một lần; quyết định không đạt, đơn thủ công độc lập và giới hạn từ chối cũ không bị trộn lẫn.
- FR-023–FR-024, Edge Cases và Assumptions xác định hiển thị, tương thích lịch sử, phạm vi in nhãn và các phần chưa được yêu cầu. Không có điểm nghiệp vụ đang chờ làm rõ.
- Đã phân biệt công khai thông tin tối thiểu qua QR với quản lý/kiểm nhận có phân quyền; chưa chốt thư viện, mã trạng thái lưu trữ, cấu trúc lưu nguồn, cơ chế cấp số hoặc hình thức tệp nhãn trong bước specify.
- Plan/research/data-model/contracts/quickstart đã cập nhật theo bản sửa đổi, gates trước/sau thiết kế đạt. tasks.md đã có58 task amendment T041–T098 pending với dependency/ownership; tasks-baseline.md giữ lịch sử cũ. Sẵn sàng implement, không dùng checklist này để khẳng định đã triển khai hoặc kiểm thử phần mềm.
- Không có `.specify/extensions.yml` khi kiểm tra trước/sau specify; không có extension hook cần thực thi.
