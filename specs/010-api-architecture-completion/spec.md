# Feature Specification: API và kiến trúc cho nhân viên bếp/dinh dưỡng

**Feature Branch**: `refactor/010-api-architecture-completion`
**Created**: 2026-11-08
**Status**: Ready for implementation
**Input**: Đối chiếu MD API, bổ sung phần thiếu và chuyển sang kiến trúc BE mới. Người dùng đã thu hẹp: chỉ phần hai role nhân viên bếp/nhân viên dinh dưỡng; các module khác do thành viên khác phụ trách.

## User Scenarios & Testing

### User Story 1 - Sổ lưu mẫu đầy đủ (Priority: P1)

Nhân viên bếp có quyền xem mẫu của trường, tìm mã mẻ/tên món, lọc trạng thái và xem thời điểm hết thời gian lưu.

**Independent Test**: Hai alias danh sách cho cùng kết quả với search/status/page/limit; expiresAt đúng +24h, totalItems cùng scope.

**Acceptance Scenarios**:

1. **Given** mẫu thuộc nhiều trường, **When** xem/tìm/lọc, **Then** chỉ mẫu đúng trường xuất hiện, count cùng filter.
2. **Given** sampledAt, **When** đọc mẫu, **Then** expiresAt bằng sampledAt +24h, thông tin mẻ/món có trong danh sách.
3. **Given** hai alias food-samples/retained-samples, **When** truy vấn giống nhau, **Then** hợp đồng giống nhau và hasNext cũ vẫn hoạt động.

### User Story 2 - Giữ luồng thực đơn và chế biến (Priority: P1)

Nhân viên dinh dưỡng và bếp tiếp tục thực hiện API đã công bố, giữ quyền, vòng đời thực đơn/mẻ, kho và lưu mẫu.

**Independent Test**: Đối chiếu 27 endpoint hiện hành; kiểm tra các luồng trong ba module được sửa và tính tương thích với module dùng chung được giữ nguyên.

**Acceptance Scenarios**:

1. **Given** API đang hoạt động, **When** chuyển lớp nội bộ, **Then** method/path/envelope/field/mã lỗi được giữ ngoại trừ phần bổ sung US1.
2. **Given** quyết định duyệt của module BGH, **When** gọi từ route menu, **Then** giữ nguyên duyệt tuần theo spec004; không sửa module menu-approval.
3. **Given** mẻ hoàn thành hoặc mẫu chưa đủ 24h/đang hold sự cố, **When** gọi lại thao tác không hợp lệ, **Then** không trừ kho hai lần hoặc hủy mẫu trái quy tắc.

### User Story 3 - Ba module theo cấu trúc mới (Priority: P2)

Thành viên phụ trách hai role có thể tìm riêng tiếp nhận HTTP, kiểm tra đầu vào, nghiệp vụ, lưu trữ và hợp đồng dữ liệu của menu/kitchen/retained-sample.

**Independent Test**: Guard kiến trúc chỉ áp dụng ba module này, kết hợp bộ test chức năng.

**Acceptance Scenarios**:

1. **Given** service của ba module, **When** đọc code, **Then** không có query hoặc cấu hình truy vấn DB; nghiệp vụ và ranh giới giao dịch vẫn ở service.
2. **Given** input có nhiều lỗi, **When** validation, **Then** trả lỗi tiếng Việt theo field path, từ chối trường lạ và không lộ dữ liệu nhạy cảm.
3. **Given** kết quả lưu trữ, **When** trả HTTP, **Then** service ánh xạ theo allowlist và serialize rõ Date/Decimal/BigInt qua hợp đồng đầu ra riêng.

### Edge Cases

- Search/status/page/limit sai kiểu, trùng tham số, rỗng hoặc vượt giới hạn.
- Mẫu đã hủy vẫn có expiresAt; quyền hủy dùng đồng hồ server và hold sự cố.
- Quyền vừa bị tắt, scope trường khác, tranh chấp/rollback, kho thiếu hoặc thao tác bị gọi hai lần.
- Complete giữ body empty/null và inspectionData JSON object legacy; preparedPortions hợp lệ nếu gửi nhưng không quyết định lượng trừ kho.
- Ví dụ role/permission/ID trong MD không thay thế catalog/UUID approved.

## Requirements

### Functional Requirements

- **FR-001**: Đối chiếu đủ 27 endpoint active trong MD; tất cả đã có route. Chỉ bổ sung gap contract xác minh được trong menu/kitchen/retained-sample.
- **FR-002**: GET mẫu MUST nhận status theo enum hiện hành và search mã mẻ/tên món, cùng trusted school scope.
- **FR-003**: Danh sách mẫu MUST thêm expiresAt ISO +24h và pagination.totalItems, giữ các field cũ và hasNext.
- **FR-004**: Alias danh sách/hủy mẫu MUST thống nhất, giữ đủ 24h/hold/ownership hiện có.
- **FR-005**: Chỉ ba module menu, kitchen, retained-sample MUST được chuyển sang cấu trúc theo AGENTS.md: Repository, Request DTO và Response DTO riêng; không sửa source module khác.
- **FR-006**: Request DTO MUST suy từ schema Zod strict; validation giữ approved fields/default/null/limits và tổng hợp lỗi theo path bằng tiếng Việt.
- **FR-007**: Service MUST map output allowlist, serialize rõ, không trả raw persistence record; repo chứa mọi where/select/include/query và không import DTO.
- **FR-008**: Service MUST giữ scope/quyền/business/transaction; mọi repo trong thao tác nguyên tử dùng cùng tx, giữ isolation và helper API mà module khác đang dùng.
- **FR-009**: Bảy file trước đó được người dùng xác nhận đã nằm trong commit57b83c1; giữ gỡ PUT kitchen, alias retained-samples và các thông báo.
- **FR-010**: Không sửa auth, permission, supplier, ingredient, dish, menu-approval, meal-attendance, meal-allocation hoặc các module khác; không schema/migration/DB deploy/catalog mới.
- **FR-011**: Chỉ sửa routes tích hợp, tests/scripts đăng ký test và tài liệu liên quan trực tiếp khi cần để kiểm chứng ba module; không chuẩn hóa toàn BE.

### Key Entities

- Thực đơn/định mức/nhóm suất: giữ quan hệ và trạng thái; BGH duyệt qua module hiện có không thay đổi.
- Mẻ/tồn kho: giữ nhu cầu đã chốt, reservation, confirm, complete và chống ghi hai lần.
- Mẫu lưu: sampledAt, expiresAt tính khi đọc, trạng thái, mẻ/món và scope trường.

## Success Criteria

- **SC-001**: 27 endpoint được đối chiếu, không mất route do refactor; không tạo endpoint trùng.
- **SC-002**: Hai alias lưu mẫu cùng kết quả/count/scope, expiresAt đúng 24h.
- **SC-003**: 3/3 module mục tiêu đạt guard phân lớp/DTO; source các module khác không có thay đổi của tác vụ.
- **SC-004**: Typecheck/build và tests liên quan đạt; các kiểm tra chưa chạy ghi đúng thực tế.

## Assumptions

- Nguồn API chính FoodPrint_Menu_CookingBatch_API_FINAL.md; AGENTS/AUTHORIZATION/spec004 được ưu tiên nếu mâu thuẫn.
- Theo chỉ đạo mới, phạm vi hai role được khoanh menu/kitchen/retained-sample. Các API dùng dish/ingredient/approval chỉ gọi code hiện có, không sửa module đó.
- Dev đã được tích hợp trước khi thu hẹp; không đảo các commit của người dùng/đồng đội. Mọi chỉnh sửa chưa commit ngoài ba module do tác vụ tạo đã được hoàn tác.
- Không tự commit/push/deploy sản phẩm công việc này.
