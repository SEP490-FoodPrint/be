# Feature Specification: System Admin quản lý quyền và bộ quyền vai trò

**Feature Branch**: `feat/role-permission-management`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Là System Admin tôi muốn chức năng có thể chỉnh sửa, thêm, ẩn, mở quyền của mọi vai trò trong hệ thống."

## Clarifications

### Session 2026-11-17

- Q: “Mọi vai trò” có bao gồm chỉnh sửa quyền của chính SYSTEM_ADMIN không? → A: Giữ SYSTEM_ADMIN chỉ đọc; quản lý quyền mọi vai trò còn lại.
- Q: “Ẩn/mở quyền” có tác dụng thế nào? → A: Tạm ngừng/kích hoạt quyền trên toàn hệ thống.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Xem và điều chỉnh bộ quyền của vai trò (Priority: P1)

Là System Admin có quyền quản trị phù hợp, tôi muốn xem các vai trò và danh mục quyền, xác định quyền đang được gán cho từng vai trò, rồi thêm hoặc thu hồi quyền để điều chỉnh công việc mà người mang vai trò đó được phép thực hiện.

**Why this priority**: Đây là luồng chính để quản trị quyền tập trung, áp dụng nhất quán cho các tài khoản cùng vai trò trong toàn hệ thống.

**Independent Test**: Chọn một vai trò có thể sửa, cấp một quyền đang hoạt động rồi thu hồi quyền đó; đối chiếu khả năng thực hiện nghiệp vụ của hai tài khoản thuộc vai trò ở hai tổ chức khác nhau.

**Acceptance Scenarios**:

1. **Given** System Admin có quyền xem và quản lý bộ quyền vai trò, **When** xem các vai trò và chọn một vai trò, **Then** nhận đúng mã, tên, nhóm tổ chức, khả năng chỉnh sửa và các quyền đã gán; từng quyền thể hiện rõ trạng thái hoạt động chung.
2. **Given** một vai trò khác SYSTEM_ADMIN chưa có quyền đang hoạt động, **When** System Admin có quyền quản lý cấp quyền đó, **Then** các tài khoản mang vai trò được sử dụng quyền từ lần thực hiện nghiệp vụ kế tiếp, trong phạm vi tổ chức và tài nguyên vốn được phép.
3. **Given** một vai trò đang có quyền, **When** System Admin thu hồi quyền đó, **Then** các tài khoản mang vai trò mất quyền ở lần thực hiện nghiệp vụ kế tiếp; các vai trò khác giữ nguyên bộ quyền.
4. **Given** một tài khoản có hạn chế riêng đối với quyền đang được cấp cho vai trò, **When** System Admin thu hồi rồi cấp lại quyền cho vai trò, **Then** hạn chế riêng của tài khoản vẫn được giữ và tài khoản không tự được mở quyền.
5. **Given** SYSTEM_ADMIN được chọn, **When** xem bộ quyền hoặc cố thêm, thu hồi hay thay thế bộ quyền, **Then** hệ thống cho xem với trạng thái chỉ đọc và từ chối mọi thay đổi, kể cả yêu cầu lưu lại bộ quyền giống hiện tại.
6. **Given** vai trò có thể sửa đang có nhiều quyền, **When** một lần lưu chứa quyền không tồn tại, quyền trùng hoặc quyền tạm ngừng được gán mới, **Then** toàn bộ lần lưu bị từ chối và bộ quyền cũ được giữ nguyên.
7. **Given** vai trò có thể sửa đang có quyền, **When** System Admin lưu bộ quyền rỗng hợp lệ, **Then** vai trò không còn quyền được gán và mọi hạn chế riêng của tài khoản vẫn được bảo toàn.

---

### User Story 2 - Tạm ngừng và kích hoạt quyền toàn hệ thống (Priority: P1)

Là System Admin có quyền quản trị phù hợp, tôi muốn “ẩn” một quyền để tạm ngừng hiệu lực trên toàn hệ thống và “mở” lại khi cần, đồng thời giữ các cấu hình cấp quyền hiện có.

**Why this priority**: Người quản trị cần tạm ngừng một khả năng nghiệp vụ đồng loạt mà không phải sửa từng vai trò hoặc dựng lại cấu hình khi mở lại.

**Independent Test**: Dùng một quyền được gán cho nhiều vai trò, tạm ngừng rồi kích hoạt; kiểm tra hiệu lực đối với tài khoản có quyền, tài khoản bị hạn chế riêng và tài khoản không được gán quyền.

**Acceptance Scenarios**:

1. **Given** một quyền đang hoạt động được gán cho nhiều vai trò, **When** System Admin có quyền phù hợp tạm ngừng quyền, **Then** từ lần thực hiện nghiệp vụ kế tiếp, quyền không còn hiệu lực với mọi tài khoản, kể cả System Admin nếu được gán quyền đó; các cấu hình gán quyền và hạn chế riêng không bị xóa.
2. **Given** quyền đã tạm ngừng, **When** System Admin có quyền phù hợp kích hoạt lại, **Then** các tài khoản vẫn thuộc vai trò được gán và không bị hạn chế riêng được sử dụng lại quyền; tài khoản bị hạn chế hoặc không được gán quyền không được tự cấp quyền.
3. **Given** quyền đã tạm ngừng, **When** người quản trị xem danh mục hoặc bộ quyền vai trò, **Then** quyền vẫn xuất hiện với trạng thái tạm ngừng, phân biệt được với quyền chưa được gán; “ẩn” không có nghĩa là xóa khỏi danh mục quản trị.
4. **Given** quyền đã ở trạng thái được yêu cầu, **When** System Admin lặp lại thao tác tạm ngừng hoặc kích hoạt, **Then** trạng thái giữ nguyên và không phát sinh cấu hình gán quyền hay hạn chế mới.
5. **Given** vai trò có một quyền đã tạm ngừng cùng các quyền đang hoạt động, **When** System Admin sửa bộ quyền của vai trò, **Then** có thể giữ hoặc thu hồi quyền tạm ngừng đã được gán, nhưng không thể gán mới quyền tạm ngừng cho vai trò chưa có quyền đó.

---

### User Story 3 - Thêm quyền mới vào danh mục (Priority: P2)

Là System Admin có quyền tạo quyền, tôi muốn thêm một quyền có mã định danh, tên, nhóm chức năng, hành động và mô tả để có thể quản lý việc cấp quyền cho các vai trò.

**Why this priority**: Danh mục cần mở rộng khi có chức năng nghiệp vụ đã được hệ thống hỗ trợ và cần phân quyền riêng.

**Independent Test**: Tạo quyền bằng mã chưa tồn tại, kiểm tra quyền xuất hiện trong danh mục và chưa được tự gán cho vai trò nào; thử tạo lại cùng mã để xác nhận không có bản ghi trùng.

**Acceptance Scenarios**:

1. **Given** System Admin có quyền tạo và dữ liệu hợp lệ, **When** thêm quyền mới, **Then** quyền được lưu ở trạng thái hoạt động, có thể được tìm lại trong danh mục và không tự được gán cho vai trò hoặc tài khoản nào.
2. **Given** một mã quyền đã tồn tại, kể cả quyền tạm ngừng, **When** tạo quyền với cùng mã, **Then** hệ thống từ chối với thông báo tiếng Việt và giữ nguyên quyền cũ.
3. **Given** dữ liệu thiếu trường bắt buộc, sai định dạng hoặc vượt giới hạn, **When** tạo quyền, **Then** hệ thống chỉ rõ các trường không hợp lệ và không tạo quyền dở dang.
4. **Given** một quyền mới chưa được chức năng nghiệp vụ sử dụng, **When** tạo hoặc gán quyền đó, **Then** hệ thống chỉ ghi nhận cấu hình phân quyền, không tự sinh chức năng hay mở rộng phạm vi truy cập tài nguyên.

---

### User Story 4 - Chỉnh sửa thông tin mô tả quyền (Priority: P2)

Là System Admin có quyền chỉnh sửa, tôi muốn sửa tên và mô tả của quyền để danh mục phản ánh đúng ý nghĩa nghiệp vụ mà không làm thay đổi các cấu hình cấp quyền đã có.

**Why this priority**: Thông tin quyền cần rõ ràng và cập nhật để người quản trị chọn đúng quyền.

**Independent Test**: Sửa tên và mô tả một quyền đã được gán, kiểm tra các vai trò thấy thông tin mới và hiệu lực của quyền không đổi.

**Acceptance Scenarios**:

1. **Given** quyền tồn tại ở trạng thái hoạt động hoặc tạm ngừng, **When** System Admin có quyền phù hợp sửa tên hoặc mô tả hợp lệ, **Then** thông tin mới xuất hiện ở danh mục và bộ quyền vai trò; mã, nhóm chức năng, hành động, trạng thái và cấu hình gán quyền không thay đổi.
2. **Given** quyền đã tồn tại, **When** cố đổi mã, nhóm chức năng, hành động hoặc gửi trường ngoài phạm vi chỉnh sửa, **Then** yêu cầu bị từ chối và thông tin cũ được giữ nguyên.
3. **Given** người gọi không phải System Admin hoặc thiếu quyền hiệu lực cho thao tác, **When** cố tạo, sửa, đổi trạng thái hoặc sửa bộ quyền vai trò, **Then** hệ thống từ chối và không thay đổi dữ liệu, kể cả khi người gọi được gán quyền quản trị nhưng thuộc tổ chức khác.

### Edge Cases

- Vai trò hoặc quyền không tồn tại: báo không tìm thấy, không tạo ngầm đối tượng mới.
- Tên quyền có khoảng trắng thừa được chuẩn hóa; tên chỉ chứa khoảng trắng bị từ chối. Mô tả có thể không có hoặc được xóa; mã, tên, nhóm chức năng và hành động là bắt buộc khi tạo.
- Các giới hạn hiện hành khi tạo được bảo toàn: mã tối đa 100 ký tự, tên 150, nhóm chức năng 80, hành động 50, mô tả 2.000. Mã dùng các phần chữ thường bắt đầu bằng chữ cái, có thể chứa chữ số/gạch dưới, phân cách bằng dấu chấm; nhóm chức năng và hành động dùng một phần cùng quy tắc.
- Bộ quyền được lưu tối đa 1.000 định danh không trùng; danh sách rỗng hợp lệ cho vai trò có thể sửa.
- Quyền tạm ngừng vẫn có thể bị thu hồi khỏi vai trò; kích hoạt lại không khôi phục các lần thu hồi đã lưu trước đó.
- Hai quản trị viên sửa cùng bộ quyền: mỗi lần lưu phải được áp dụng trọn vẹn; kết quả là một bộ quyền đã lưu đầy đủ, không trộn một phần từ nhiều lần lưu. Chưa yêu cầu cảnh báo người đang sửa dữ liệu cũ.
- Quyền quản trị của người thao tác bị thu hồi, tạm ngừng hoặc tài khoản bị khóa trước thời điểm chấp nhận thay đổi: từ chối toàn bộ thay đổi.
- Đổi trạng thái toàn cục áp dụng cả quyền dùng để quản trị. Nếu tạm ngừng quyền quản trị mà một System Admin đang sử dụng, các thao tác tiếp theo của người đó cũng bị từ chối theo quyền hiệu lực; không có ngoại lệ tự cấp lại quyền.
- Lỗi khi lưu: không để lại bộ quyền, thông tin quyền hoặc trạng thái chỉ được cập nhật một phần; không thông báo thành công khi chưa lưu thành công.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST chỉ cho tài khoản System Admin đang hoạt động thuộc nhóm tổ chức hệ thống và có quyền hiệu lực tương ứng thực hiện từng thao tác quản trị; danh xưng System Admin tự nó không thay thế kiểm tra quyền.
- **FR-002**: Hệ thống MUST cho người có quyền xem danh mục quyền và danh sách vai trò hiện có; vai trò có mã, tên, nhóm tổ chức và khả năng chỉnh sửa; quyền có định danh, mã, tên, nhóm chức năng, hành động, mô tả và trạng thái hoạt động. Danh sách có phân trang để duyệt hết dữ liệu theo quy ước hiện hành.
- **FR-003**: Hệ thống MUST cho người có quyền xem đầy đủ bộ quyền đã gán của vai trò được chọn, bao gồm quyền tạm ngừng; trạng thái được gán và trạng thái hoạt động chung MUST phân biệt được.
- **FR-004**: System Admin có quyền tạo MUST thêm được quyền mới với mã duy nhất và các trường hợp lệ theo giới hạn ở Edge Cases. Quyền mới MUST mặc định hoạt động và không tự gán cho bất kỳ vai trò hay tài khoản nào.
- **FR-005**: System Admin có quyền chỉnh sửa MUST sửa được tên và mô tả của quyền đang hoạt động hoặc tạm ngừng; mã, nhóm chức năng và hành động MUST bất biến sau khi tạo. Sửa thông tin MUST không thay đổi trạng thái, bộ quyền vai trò hoặc hạn chế riêng.
- **FR-006**: System Admin có quyền quản lý bộ quyền MUST cấp, thu hồi và lưu bộ quyền của mọi vai trò hiện có ngoại trừ SYSTEM_ADMIN. Thay đổi MUST áp dụng cho mọi tài khoản mang vai trò đó trên toàn hệ thống mà không mở rộng phạm vi sở hữu hoặc quan hệ tổ chức.
- **FR-007**: Bộ quyền gán của SYSTEM_ADMIN MUST chỉ đọc; mọi lần thêm, thu hồi, thay thế hoặc lưu lại bộ quyền này MUST bị từ chối. Không tạo ngoại lệ tự sửa quyền cho chính người quản trị.
- **FR-008**: System Admin có quyền đổi trạng thái MUST tạm ngừng hoặc kích hoạt lại quyền toàn hệ thống. “Ẩn” MUST được hiểu là tạm ngừng hiệu lực, “mở” MUST được hiểu là kích hoạt; quyền vẫn có thể được xem và quản lý trong danh mục khi tạm ngừng.
- **FR-009**: Tạm ngừng quyền MUST làm quyền mất hiệu lực với mọi tài khoản được gán, kể cả System Admin. Quy tắc chỉ đọc ở FR-007 chỉ bảo vệ danh sách gán quyền của SYSTEM_ADMIN, không tạo ngoại lệ đối với trạng thái toàn cục.
- **FR-010**: Đổi trạng thái MUST bảo toàn bộ quyền gán và hạn chế riêng hiện có. Khi kích hoạt lại, chỉ tài khoản vẫn được gán quyền qua vai trò và không bị hạn chế riêng mới có thể sử dụng quyền.
- **FR-011**: Khi lưu bộ quyền, hệ thống MUST từ chối định danh không tồn tại, trùng lặp, vượt giới hạn hoặc gán mới quyền tạm ngừng. Quyền tạm ngừng đã được gán MUST có thể được giữ nguyên hoặc thu hồi; bộ quyền rỗng MUST được chấp nhận cho vai trò có thể sửa.
- **FR-012**: Quyền hiệu lực MUST dựa trên tài khoản, vai trò, tổ chức, trạng thái quyền và hạn chế riêng hiện tại. Thay đổi đã lưu MUST có hiệu lực ở lần thực hiện nghiệp vụ kế tiếp, không yêu cầu đăng nhập lại; không tự mở lại quyền bị hạn chế riêng khi sửa bộ quyền vai trò.
- **FR-013**: Mỗi thao tác ghi MUST kiểm tra lại tư cách và quyền hiện tại của người thao tác tại thời điểm chấp nhận thay đổi; mỗi lần lưu MUST có tính toàn vẹn, thành công toàn bộ hoặc không có thay đổi. Các lần ghi đồng thời MUST không tạo bộ quyền chắp vá hay cho phép dùng quyền quản trị đã bị thu hồi trước thời điểm chấp nhận.
- **FR-014**: Dữ liệu không hợp lệ MUST được báo bằng tiếng Việt với các trường liên quan; thiếu phiên, thiếu quyền và đối tượng không tồn tại MUST được phân biệt theo quy ước phản hồi hiện hành. Kết quả MUST không lộ thông tin xác thực, bí mật hoặc dữ liệu tài khoản không cần thiết.
- **FR-015**: Tính năng MUST giữ cơ chế quản trị viên tổ chức chỉ hạn chế/mở lại quyền đã thuộc vai trò của tài khoản cùng tổ chức. Cán bộ an toàn thực phẩm MUST không được quản trị quyền dù được gán một quyền quản trị.
- **FR-016**: Tạo quyền MUST không tự tạo chức năng nghiệp vụ hoặc làm quyền có hiệu lực ở chức năng chưa sử dụng quyền đó. Tính năng MUST không thêm, sửa hoặc xóa vai trò, đổi vai trò tài khoản, xóa vĩnh viễn quyền, hay bổ sung lịch sử hạn chế riêng.

### Key Entities _(include if feature involves data)_

- **Quyền**: Một khả năng nghiệp vụ có định danh, mã ổn định, tên, nhóm chức năng, hành động, mô tả và trạng thái hoạt động chung. Trạng thái này chi phối hiệu lực ở mọi nơi quyền được gán.
- **Vai trò**: Nhóm trách nhiệm hiện có, có mã, tên, nhóm tổ chức và bộ quyền gán dùng chung cho các tài khoản mang vai trò. SYSTEM_ADMIN có bộ quyền chỉ đọc.
- **Gán quyền cho vai trò**: Quan hệ xác định một quyền thuộc bộ quyền vai trò; quan hệ vẫn tồn tại khi quyền tạm ngừng trừ khi người có thẩm quyền chủ động thu hồi.
- **Hạn chế quyền riêng của tài khoản**: Cấu hình hiện hành chặn một quyền được vai trò cấp trong tổ chức hiện tại; không bị xóa hay vượt qua khi sửa bộ quyền hoặc kích hoạt quyền toàn cục.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Trong 100% kịch bản cấp và thu hồi quyền hợp lệ, tài khoản thuộc vai trò ở ít nhất hai tổ chức phản ánh đúng thay đổi từ lần thực hiện nghiệp vụ kế tiếp, đồng thời không có truy cập vượt phạm vi tổ chức.
- **SC-002**: Trong 100% kịch bản tạm ngừng/kích hoạt, quyền đổi hiệu lực đúng ở tất cả vai trò được gán, bao gồm System Admin nếu được gán; không mất bất kỳ cấu hình gán quyền hoặc hạn chế riêng nào do thao tác đổi trạng thái.
- **SC-003**: 100% lần tạo quyền hợp lệ tạo đúng một quyền chưa gán; mọi lần tạo trùng bị từ chối. Mọi lần sửa mô tả hợp lệ giữ nguyên định danh và hiệu lực quyền.
- **SC-004**: 100% lần sửa bộ quyền SYSTEM_ADMIN, thao tác thiếu thẩm quyền, và lần lưu chứa dữ liệu không hợp lệ bị từ chối mà không có thay đổi một phần.
- **SC-005**: Người kiểm thử có đủ quyền hoàn thành được cả bốn luồng xem/sửa bộ quyền, thêm quyền, sửa thông tin và tạm ngừng/kích hoạt chỉ bằng dữ liệu quản trị được cung cấp, không cần biết trước định danh nội bộ.
- **SC-006**: Với dữ liệu kiểm thử gồm ít nhất hai vai trò và hai tổ chức, mọi trường hợp cấp lại bộ quyền hoặc kích hoạt quyền đều giữ 100% hạn chế riêng đã có; các lần lưu đồng thời kết thúc bằng một cấu hình đầy đủ đã được chấp nhận.

## Assumptions

- Hai câu trả lời trong Clarifications chốt phạm vi: bộ quyền SYSTEM_ADMIN chỉ đọc; ẩn/mở là đổi trạng thái quyền toàn cục. Trạng thái toàn cục vẫn ảnh hưởng đến quyền hiệu lực của System Admin.
- “Thêm” gồm tạo mục quyền mới và cấp quyền cho vai trò; “chỉnh sửa” gồm sửa tên/mô tả quyền và thay đổi bộ quyền vai trò. Mã, nhóm chức năng, hành động được giữ ổn định để bảo toàn ý nghĩa quyền đã được chức năng nghiệp vụ sử dụng.
- Kế thừa danh mục vai trò và cơ chế xác thực, phân quyền, hạn chế riêng, phản hồi và phân trang hiện tại theo [AUTHORIZATION.md](../../docs/AUTHORIZATION.md) và [AGENTS.md](../../AGENTS.md). Việc tách quyền cụ thể cho sửa thông tin/đổi trạng thái sẽ được xác định khi lập kế hoạch, không tự cấp quyền cho tài khoản hiện có.
- Đây là đặc tả hành vi backend. Thiết kế giao diện quản trị, tạo màn hình, khôi phục quyền quản trị bằng thao tác vận hành và tự động đồng bộ danh mục không nằm trong phạm vi.
- Chưa thực hiện triển khai, khởi tạo quyền quản trị mới hay thay đổi dữ liệu thực tế; mọi thao tác dữ liệu/môi trường phải tuân thủ chính sách cho phép riêng của dự án.
