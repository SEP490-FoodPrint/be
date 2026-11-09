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
- Khoảng ngày đảo ngược phải bị từ chối; page/limit không hợp lệ, schoolId từ client và search sai kiểu không được đi vào truy vấn.

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
- **FR-012**: Danh sách thực đơn MUST hỗ trợ search tùy chọn theo tiêu đề tuần hoặc tên món; tối đa 100 ký tự sau trim, chuỗi rỗng tương đương không tìm. Kết hợp với date/weekStartDate/status và school scope, count và danh sách cùng điều kiện.
- **FR-013**: Danh sách mẻ và KPI MUST dùng cùng bộ lọc DB cho ngày/khoảng ngày, trạng thái, ca, phương thức, món/ngày thực đơn và search mã mẻ/tên món/số suất; startDate lớn hơn endDate MUST trả400. Giữ phân trang mặc định20, tối đa100 và sort ổn định theo khóa phụ.
- **FR-014**: Danh sách mẫu MUST tìm cùng lúc tủ lưu/mã mẻ/tên món, kết hợp status và school scope, trả totalItems/hasNext và expiresAt đúng24h, thực hiện list/count tại DB với cùng điều kiện.
- **FR-015**: Chức năng chỉnh sửa mẻ đã loại khỏi phạm vi MUST được gỡ cả controller/service/validator/DTO thừa; API PUT mẻ tiếp tục không tồn tại. Không xóa quyền dùng để xóa mẻ hoặc lịch sử kho cần cho tính toàn vẹn.
- **FR-016**: Theo xác nhận bổ sung của người dùng, FE của hai role MUST gỡ nút/modal/state/handler và style riêng của chức năng in/xuất không làm. Chỉ sửa màn MenuPlanning/KitchenCooking liên quan; không sửa màn BGH hoặc phân hệ khác. BE hiện không có endpoint xuất/in trong ba module, không tạo endpoint giả hoặc xóa reporting dùng chung.
- **FR-017**: Luồng FE thực đơn/chế biến/lưu mẫu MUST dùng dữ liệu và kết quả ghi thật từ API. Không runtime mock records, ID/trường/giờ/suất giả, localStorage giả persistence, hoặc báo thành công khi API thất bại; items rỗng phải hiển thị rỗng, data:null là không có dữ liệu, lỗi/abort không biến thành mock.
- **FR-018**: Create/Save/Submit/Delete/Confirm/Complete/Sample/Dispose MUST await API thành công rồi refresh hoặc cập nhật bằng DTO server. Không timer/toast giả thành công. Không phục hồi chỉnh sửa mẻ/mẫu hoặc phân bổ đang hoãn.
- **FR-019**: Edit một bữa MUST gửi snapshot tuần đầy đủ được merge từ dữ liệu server, giữ các ngày/bữa/định mức/gia vị không chỉnh. Request chỉ có ID thật, số thập phân không bị parseInt, từng nguyên liệu có định mức riêng; không suy diễn recipe từ tên món.
- **FR-020**: Bếp và dinh dưỡng MUST đọc context trường/lịch qua quyền view hiện hành và trusted principal, không cần school.manage hoặc hardcode schoolId. Context chỉ whitelist id/name/cookingMode/giờ ăn/academicYears hiện có; chưa cấu hình thì hiển thị rõ, không thay bằng lịch giả.
- **FR-021**: Mẫu lưu MUST có filter mealType/date/readyToDispose, stats toàn phạm vi và mẻ COMPLETED chưa lấy mẫu qua hasSample=false. READY là derived state từ sampledAt +24h theo đồng hồ server, không thêm enum/column. Date mẫu theo ngày trường UTC+07, list/count/stats cùng filter/scope.
- **FR-022**: API context/menu/dish/group/ingredient/lot fields MUST được đối chiếu với Prisma schema và test DB disposable. Dữ liệu lot/name/expiry được whitelist từ quan hệ thật hoặc hiển thị thiếu; không bịa mã/hạn/chứng nhận.
- **FR-023**: Ingredient options trong module menu MUST hỗ trợ paging/search thật; avoidance options trả IngredientEntry IDs của trường, không dùng Ingredient IDs thay thế. Chỉ đọc catalog existing, không sửa CRUD module của thành viên khác.
- **FR-024**: Cấu hình API/cookie/CSRF shared MUST giữ nguyên nếu đã đúng. Không thử ghi vào BE đang kết nối database remote; kiểm thử ghi dùng database/API disposable riêng. Runtime/mock regression tests được phép dùng fixtures chỉ trong tests, không đưa vào production bundle.

- **FR-025**: Số tuần học MUST được BE tính từ tuần chứa `SchoolAcademicYear.startDate` của trường đã xác thực: tuần Thứ Hai–Chủ Nhật đầu tiên là tuần 1, tăng liên tục qua năm dương lịch. Không dùng số tuần ISO, không lưu thêm số tuần trong DB. Giữ `WeeklyMenu.weekStartDate` làm khóa ngày nhóm thực đơn; schema hiện không có cột số tuần để xóa.
- **FR-026**: API menu MUST cung cấp năm học, danh sách tuần, số tuần/nhãn và khoảng ngày từ cấu hình thật. Thiếu cấu hình trả danh sách rỗng; lịch tuần ngoài năm học trả số tuần null, không thay bằng lịch mẫu. Ngày nghỉ không đánh lại số tuần. Giữ nguyên quy tắc gửi duyệt hiện hành.
- **FR-027**: FE MenuPlanning MUST chọn năm học/tuần bằng dữ liệu API, dùng ngày đầu tuần làm khóa để không trùng qua năm; tiêu đề là `Thực đơn tuần N` với N do BE trả. Không dùng tiêu đề tự nhập hoặc lịch năm học mock để quyết định số tuần.

### Key Entities

- **FR-028**: Theo yêu cầu rà soát toàn bộ hai role, MUST lập bằng chứng FE → API → repository/Prisma cho từng chức năng đang hiển thị, gồm filter/search/paging, trạng thái, lưu và các ràng buộc. Sửa các hợp đồng sai trong menu/kitchen/retained-sample theo FR017–FR024; chức năng của module khác hoặc đã tạm hoãn phải báo rõ mức độ tích hợp, không tự dựng nghiệp vụ/model mới. Không dùng Azure để kiểm thử ghi và không sửa README/.gitignore.

- Thực đơn/định mức/nhóm suất: giữ quan hệ và trạng thái; BGH duyệt qua module hiện có không thay đổi.
- Mẻ/tồn kho: giữ nhu cầu đã chốt, reservation, confirm, complete và chống ghi hai lần.
- Mẫu lưu: sampledAt, expiresAt tính khi đọc, trạng thái, mẻ/món và scope trường.

## Success Criteria

- **SC-001**: 27 endpoint được đối chiếu, không mất route do refactor; không tạo endpoint trùng.
- **SC-002**: Hai alias lưu mẫu cùng kết quả/count/scope, expiresAt đúng 24h.
- **SC-003**: 3/3 module mục tiêu đạt guard phân lớp/DTO; source các module khác không có thay đổi của tác vụ.
- **SC-004**: Typecheck/build và tests liên quan đạt; các kiểm tra chưa chạy ghi đúng thực tế.
- **SC-005**: Test chứng minh filter/search/count/pagination giữ school scope; FE hai role không còn handler/nút/modal in/xuất, BE không còn code chỉnh sửa mẻ đã bỏ và không mở route xuất/in.
- **SC-006**: UI không còn mock fallback ở luồng hai role; lỗi400/401/403/409/422/503 không báo thành công. Reload sau ghi phản ánh dữ liệu server, edit giữ bữa/ngày khác và các contract FE/BE có regression tests.

## Assumptions

- Nguồn API chính FoodPrint_Menu_CookingBatch_API_FINAL.md; AGENTS/AUTHORIZATION/spec004 được ưu tiên nếu mâu thuẫn.
- Theo chỉ đạo mới, phạm vi hai role được khoanh menu/kitchen/retained-sample. Các API dùng dish/ingredient/approval chỉ gọi code hiện có, không sửa module đó.
- Dev đã được tích hợp trước khi thu hẹp; không đảo các commit của người dùng/đồng đội. Mọi chỉnh sửa chưa commit ngoài ba module do tác vụ tạo đã được hoàn tác.
- Không tự commit/push/deploy sản phẩm công việc này.
