# Feature Specification: Đổi trạng thái ẩn/hiện nguyên liệu nhà cung cấp

**Feature Branch**: `feat/ingredient-change-status`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Là admin của nhà cung cấp tôi muốn ẩn/hiện nguyên liệu, hiện tại đã có api ẩn nguyên liệu nhưng chưa có api mở lại nguyên liệu đã ẩn. Gộp lại 2 api thành 1 là change status."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Ẩn hoặc hiện lại bằng một thao tác đổi trạng thái (Priority: P1)

Quản trị nhà cung cấp chọn trạng thái mong muốn cho nguyên liệu của mình bằng cùng một thao tác. Nguyên liệu có thể ngừng cung ứng và được mở lại khi nhà cung cấp sẵn sàng cung ứng tiếp.

**Why this priority**: Bổ sung khả năng mở lại nguyên liệu đã ẩn và thống nhất cách điều khiển cả hai chiều của vòng đời nguyên liệu.

**Independent Test**: Dùng quản trị hợp lệ của nhà cung cấp A với một nguyên liệu đang hoạt động và một nguyên liệu đã ẩn; thực hiện lần lượt cả hai chiều đổi trạng thái, rồi đọc lại danh sách và chi tiết quản trị.

**Acceptance Scenarios**:

1. **Given** nguyên liệu A đang `ACTIVE`, **When** quản trị A chọn trạng thái đích `INACTIVE`, **Then** nguyên liệu được ẩn, kết quả trả về và lần đọc quản trị tiếp theo đều ghi nhận `INACTIVE`.
2. **Given** nguyên liệu A đã `INACTIVE`, **When** quản trị A chọn trạng thái đích `ACTIVE`, **Then** chính nguyên liệu đó được hiện lại, kết quả trả về và lần đọc quản trị tiếp theo đều ghi nhận `ACTIVE`.
3. **Given** một nguyên liệu đang ở trạng thái đích, **When** quản trị gửi lại yêu cầu đặt đúng trạng thái đó, **Then** thao tác thành công, không đảo trạng thái và không thay đổi thời điểm cập nhật chỉ vì gửi lặp.
4. **Given** quản trị cần ẩn hoặc hiện lại nguyên liệu, **When** sử dụng chức năng quản trị sau thay đổi, **Then** cả hai nhu cầu đều dùng một thao tác đổi trạng thái; thao tác chỉ ẩn trước đây đã được thay thế.

---

### User Story 2 - Đổi trạng thái đúng quyền và phạm vi sở hữu (Priority: P1)

Chỉ quản trị đủ điều kiện mới được đổi trạng thái nguyên liệu của nhà cung cấp mình đang đại diện, kể cả khi tiếp tục dùng phiên đăng nhập cũ sau khi quyền đã thay đổi.

**Why this priority**: Khả năng mở lại nguyên liệu phải tuân theo cùng giới hạn quyền và tổ chức như thao tác ẩn hiện có.

**Independent Test**: Chuẩn bị nguyên liệu của A và B, quản trị A, staff A và tài khoản đã mất quyền; kiểm tra cả yêu cầu ẩn lẫn hiện lại với từng đối tượng.

**Acceptance Scenarios**:

1. **Given** quản trị A có tài khoản và nhà cung cấp đang hoạt động cùng quyền `ingredient.manage` hiệu lực, **When** đổi trạng thái nguyên liệu thuộc A, **Then** thao tác được phép.
2. **Given** staff A được gán quyền quản lý hoặc người có vai trò khác, kể cả System Admin, **When** yêu cầu đổi trạng thái, **Then** bị từ chối và trạng thái không đổi.
3. **Given** nguyên liệu thuộc B hoặc mã nguyên liệu không tồn tại, **When** quản trị A đổi trạng thái, **Then** nhận cùng kết quả không tìm thấy, không được tiết lộ dữ liệu của B.
4. **Given** tài khoản, membership, nhà cung cấp hoặc quyền quản lý không còn đáp ứng điều kiện khi xử lý thay đổi, **When** gửi yêu cầu bằng phiên đăng nhập trước đó, **Then** bị từ chối và không thay đổi nguyên liệu.

---

### User Story 3 - Giữ dữ liệu và lịch sử qua các lần ẩn/hiện (Priority: P2)

Quản trị có thể đổi trạng thái nhiều lần mà vẫn giữ nguyên nguyên liệu và các hồ sơ đã dùng nguyên liệu đó.

**Why this priority**: Mở lại nguyên liệu giúp tiếp tục cung ứng bằng bản ghi cũ, bảo toàn thông tin và khả năng truy xuất lịch sử.

**Independent Test**: Với nguyên liệu có ảnh, danh mục và liên kết nghiệp vụ, thực hiện chu kỳ `ACTIVE → INACTIVE → ACTIVE`; so sánh dữ liệu, liên kết và khả năng lựa chọn trước và sau chu kỳ.

**Acceptance Scenarios**:

1. **Given** nguyên liệu có thông tin và liên kết nghiệp vụ, **When** ẩn rồi hiện lại, **Then** định danh, chủ sở hữu, tên, đơn vị, mô tả, danh mục, ảnh, thời điểm tạo và liên kết hiện có được bảo toàn; thời điểm cập nhật phản ánh lần thực sự đổi trạng thái.
2. **Given** nguyên liệu đã ẩn, **When** xem danh sách quản trị hoặc lựa chọn nguyên liệu mới, **Then** nguyên liệu vẫn có trong quản trị với trạng thái ẩn và không được lựa chọn mới theo quy tắc hiện hành.
3. **Given** nguyên liệu đã được hiện lại, **When** xem lựa chọn nguyên liệu mới, **Then** nguyên liệu đủ điều kiện về trạng thái; các điều kiện quyền, đối tác và nghiệp vụ khác vẫn được áp dụng.
4. **Given** nguyên liệu có hồ sơ lịch sử hoặc giao dịch đang xử lý, **When** đổi trạng thái nguyên liệu, **Then** các hồ sơ và giao dịch đó không tự động bị hủy, mở lại hoặc thay đổi trạng thái theo nguyên liệu.
5. **Given** nguyên liệu đang ẩn, **When** chỉ sửa thông tin nguyên liệu, **Then** nguyên liệu vẫn ẩn; muốn hiện lại phải sử dụng thao tác đổi trạng thái.

### Edge Cases

- Thiếu trạng thái, trạng thái rỗng, `null`, sai kiểu hoặc ngoài `ACTIVE`/`INACTIVE`: từ chối toàn bộ yêu cầu với thông báo tiếng Việt chỉ rõ trường liên quan.
- Gửi thuộc tính ngoài nội dung đổi trạng thái, như chủ sở hữu hoặc thông tin nguyên liệu: từ chối, không sửa kèm dữ liệu khác.
- Mã nguyên liệu sai định dạng: báo dữ liệu không hợp lệ; mã hợp lệ nhưng không tồn tại hoặc ngoài sở hữu: cùng kết quả không tìm thấy.
- Chưa đăng nhập: không cho phép thao tác; yêu cầu lặp với trạng thái hiện tại vẫn phải qua đầy đủ kiểm tra quyền và sở hữu.
- Gửi lặp một trạng thái sau khi kết quả trước đó chưa đến người dùng: không gây đảo trạng thái ngoài ý muốn.
- Nhiều yêu cầu đồng thời: mỗi yêu cầu được chấp nhận phải áp dụng đúng trạng thái đích của nó theo thứ tự thay đổi được ghi nhận; trạng thái cuối cùng phản ánh lần ghi nhận sau cùng, không phát sinh bản ghi nguyên liệu mới.
- Lỗi khi lưu: không trả thành công và không để lại thay đổi một phần; người dùng có thể đọc lại trạng thái hiện tại.
- Nguyên liệu đã ẩn trước khi có tính năng này: được mở lại bằng cùng quy tắc, không cần tạo bản sao hoặc đăng ký lại.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Cung cấp một thao tác đổi trạng thái duy nhất cho cả ẩn và hiện lại nguyên liệu, thay thế thao tác chỉ ẩn hiện có; không cung cấp thêm thao tác mở lại riêng biệt.
- **FR-002**: Người thao tác phải chỉ định trạng thái đích: `INACTIVE` để ẩn hoặc `ACTIVE` để hiện. Hệ thống phải đặt đúng trạng thái được yêu cầu, không tự suy ra bằng cách đảo trạng thái hiện tại.
- **FR-003**: Cho phép cả hai chuyển đổi `ACTIVE → INACTIVE` và `INACTIVE → ACTIVE`, bao gồm nguyên liệu đã bị ẩn trước khi tính năng được triển khai.
- **FR-004**: Yêu cầu đặt trạng thái trùng trạng thái hiện tại phải thành công, trả trạng thái hiện tại và không ghi lại thời điểm cập nhật chỉ vì gửi lặp.
- **FR-005**: Chỉ tài khoản đang hoạt động có vai trò `INGREDIENT_SUPPLIER_ADMIN`, membership nhà cung cấp hợp lệ, nhà cung cấp đang hoạt động và quyền `ingredient.manage` hiệu lực được đổi trạng thái. Staff và các vai trò khác không được phép, kể cả khi được gán quyền đó; không có quyền vượt kiểm tra ngầm cho System Admin.
- **FR-006**: Xác định phạm vi nhà cung cấp từ danh tính và membership hiện tại đã xác thực. Chỉ đổi trạng thái nguyên liệu thuộc phạm vi đó; không cho người dùng chỉ định hoặc chuyển chủ sở hữu. Nguyên liệu ngoài sở hữu và không tồn tại phải được xử lý như nhau là không tìm thấy.
- **FR-007**: Kiểm tra lại điều kiện tài khoản, vai trò, membership, quyền hiệu lực, nhà cung cấp và quyền sở hữu tại thời điểm thực hiện thay đổi; việc kiểm tra và thay đổi phải là một thao tác toàn vẹn, không chấp nhận quyền đã mất tại thời điểm kiểm tra.
- **FR-008**: Chỉ chấp nhận trạng thái đích hợp lệ và mã nguyên liệu hợp lệ. Thiếu hoặc sai trạng thái, mã sai định dạng hay thuộc tính thừa phải bị từ chối trọn vẹn, báo lỗi tiếng Việt kèm trường liên quan và không lộ giá trị nhạy cảm.
- **FR-009**: Khi thực sự đổi trạng thái, chỉ thay đổi trạng thái cùng thời điểm cập nhật hiện có. Bảo toàn định danh, chủ sở hữu, nội dung nguyên liệu, thời điểm tạo, các liên kết và lịch sử nghiệp vụ; không tạo bản sao, xóa nguyên liệu hay tự thay đổi trạng thái hồ sơ liên quan.
- **FR-010**: Sau thao tác thành công, trả thông tin nguyên liệu với trạng thái đã ghi nhận theo khuôn phản hồi và các trường được phép hiện hành. Lần đọc quản trị tiếp theo phải phản ánh trạng thái đã lưu, trừ khi đã có thay đổi hợp lệ tiếp theo.
- **FR-011**: Danh sách và chi tiết quản trị tiếp tục cho phép quản trị xem nguyên liệu của mình ở cả hai trạng thái. Ẩn loại nguyên liệu khỏi lựa chọn mới theo quy tắc hiện hành; hiện lại khôi phục điều kiện về trạng thái, không vượt qua các điều kiện nghiệp vụ khác.
- **FR-012**: Thao tác sửa thông tin nguyên liệu tiếp tục giữ trạng thái hiện tại; thay đổi trạng thái chỉ thực hiện qua thao tác chuyên biệt chung cho hai chiều.
- **FR-013**: Chuẩn hóa mô tả và hướng dẫn sử dụng chức năng quản trị nguyên liệu theo một thao tác đổi trạng thái; loại bỏ hướng dẫn chỉ ẩn một chiều và giới hạn cũ rằng nguyên liệu không thể được mở lại.

### Key Entities

- **Nguyên liệu**: Bản ghi thuộc một nhà cung cấp, giữ định danh qua mọi lần ẩn/hiện; `ACTIVE` biểu thị đang hoạt động và `INACTIVE` biểu thị đang ẩn.
- **Quản trị nhà cung cấp**: Tài khoản với vai trò và quyền quản lý nguyên liệu hiệu lực, được giới hạn bởi membership hiện tại và tình trạng hoạt động của nhà cung cấp.
- **Hồ sơ nghiệp vụ liên quan**: Các hồ sơ kho, thực đơn, hợp đồng, giao nhận hoặc truy xuất đã liên kết với nguyên liệu; việc đổi trạng thái nguyên liệu bảo toàn những liên kết này.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% kịch bản hợp lệ cho cả hai chiều ẩn/hiện hoàn thành bằng cùng một thao tác và đọc lại đúng trạng thái đích, bao gồm nguyên liệu đã ẩn từ trước.
- **SC-002**: 100% trường hợp gửi lặp cùng trạng thái giữ nguyên trạng thái và thời điểm cập nhật sau lần thay đổi đầu tiên.
- **SC-003**: 100% trường hợp thiếu quyền, sai vai trò, mất điều kiện hoạt động hoặc truy cập chéo nhà cung cấp bị chặn, không thay đổi hay tiết lộ dữ liệu nguyên liệu ngoài quyền hạn.
- **SC-004**: Sau ít nhất ba chu kỳ ẩn/hiện trên cùng nguyên liệu có liên kết nghiệp vụ, toàn bộ thông tin ngoài trạng thái và thời điểm cập nhật cùng các liên kết lịch sử được giữ nguyên, không phát sinh nguyên liệu trùng lặp.
- **SC-005**: 100% trường hợp dữ liệu trạng thái không hợp lệ bị từ chối với thông báo xác định được trường lỗi và không thay đổi dữ liệu đã lưu.

## Assumptions

- Đây là thay đổi có phạm vi riêng tiếp nối [quản trị nguyên liệu nhà cung cấp](../008-supplier-ingredient-management/spec.md). Đặc tả này thay thế giới hạn chỉ ẩn một chiều và chưa cho khôi phục hiển thị trong đặc tả trước; các quy tắc quản trị khác tiếp tục áp dụng.
- “Gộp thành change status” được hiểu là thay thế thao tác ẩn cũ bằng một thao tác nhận trạng thái đích cho cả hai chiều; không giữ thao tác ẩn cũ như một lựa chọn song song. Chi tiết hợp đồng và việc cập nhật bên sử dụng được xác định khi lập kế hoạch.
- Sử dụng hai trạng thái đang có `ACTIVE`/`INACTIVE`; không bổ sung trạng thái vòng đời mới hoặc trạng thái hiển thị riêng.
- Khả năng mở lại không đòi hỏi đăng ký nguyên liệu lại hoặc thêm điều kiện nghiệp vụ mới ngoài điều kiện quyền và sở hữu hiện có của thao tác ẩn.
- Phạm vi là thay đổi hành vi quản trị nguyên liệu ở backend và tài liệu liên quan; không bao gồm xây dựng màn hình mới, xóa vĩnh viễn, quản trị danh mục hoặc cập nhật hàng loạt.
- Việc thực hiện dựa trên chức năng xác thực, phân quyền, danh sách/chi tiết quản trị và dữ liệu nguyên liệu hiện có. Tạo đặc tả không cấp phép thay đổi dữ liệu hoặc triển khai trên môi trường đang sử dụng.
