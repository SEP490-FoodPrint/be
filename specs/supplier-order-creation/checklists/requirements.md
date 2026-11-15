# Specification Quality Checklist: Tạo đơn giao hàng theo từng bước

**Purpose**: Kiểm tra chất lượng đặc tả trước khi lập kế hoạch.

**Created**: 2026-11-14

**Updated**: 2026-11-15 — sửa đổi xác nhận, hoàn tất nguyên liệu và bắt đầu giao cho cả hai cách tạo.

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

- Đặc tả35 FR/14 SC đạt16/16 tiêu chí, không còn câu hỏi nghiệp vụ hoặc marker chờ làm rõ. Hai câu hỏi mới đã chốt: cùng thực phẩm được nhiều dòng khác nguồn; áp dụng cả hai cách tạo và REQUEST giữ đúng tổng lượng mỗi dòng yêu cầu gốc.
- Yêu cầu bổ sung hiện hành: STANDALONE không có Đã xác nhận ở form/context/progress/status; tìm/chọn trường và thêm nguyên liệu trực tiếp, lưu hợp lệ mới PREPARING. Chỉ REQUEST đã tiếp nhận có CONFIRMED projection. Không bỏ bốn bên kiểm nhận sau arrival.
- FR-005/FR-014/FR-032/FR-033, Story1/2/4, entities và SC-002/SC-013 giữ riêng từng dòng/số lượng/nguồn/QR;6A+4B=10 hợp lệ, trùngA hoặc tổng9/11 bị chặn. Các nguyên liệu khác nhau vẫn dùng chung cơ sở.
- FR-034/FR-035, Story2 và SC-014 bao phủ tìm trường theo một phần tên/mã không phân biệt hoa/thường, mặc định blank/empty, pagination/eligibility và phạm vi supplier tin cậy. Không dùng search để mở quyền hoặc thay recheck POST.
- FR-006/FR-009/FR-023/FR-025–FR-031 và SC-008/SC-011/SC-012 xác định luồng riêng của từng mode, dispatch đủ ETA/plate, error/replay/reopen không nhảy/lùi trạng thái và không tạo kho sớm.
- Assumptions/scope giữ bản nhập dở, sửa nội dung đã hoàn tất, layout frontend, tracking bao bì/xe, payment ngoài phạm vi; phân biệt thực phẩm/nguyên liệu, cơ sở nguồn và trường nhận. Không đưa cách tổ chức query/schema/migration vào business requirements.
- Plan/research/data-model/contracts/quickstart đã cập nhật và gate Constitution trước/sau thiết kế đạt; chỉ là đối chiếu thiết kế. Tasks T100–T156 đã cập nhật theo35 FR/14 SC và vẫn pending; tasks-traceability.md/tasks-baseline.md giữ nguyên lịch sử.
- Không có extension config/hook trước hoặc sau plan/tasks. Lần cập nhật này chỉ kiểm cấu trúc/liên kết/định dạng tài liệu, không tạo migration SQL/chạy DB hoặc test phần mềm. Checklist không chứng minh đã implement/kiểm thử luồng mới.
