# Feature Specification: Tiếp nhận yêu cầu nguyên liệu của nhà cung cấp

**Feature Branch**: `feat/supplier-order-intake`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "tôi muốn thêm tính năng tiếp nhận yêu cầu đơn nguyên liệu từ nhà trường, cả admin và staff đều sử dụng được tính năng này"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Xem các yêu cầu nhà trường đã gửi (Priority: P1)

Là admin hoặc staff nhà cung cấp, tôi muốn xem các yêu cầu nguyên liệu được gửi đến đơn vị mình để biết đơn nào đang chờ tiếp nhận và theo dõi các đơn đã nhận.

**Why this priority**: Người tiếp nhận cần xác định đúng yêu cầu và trường gửi trước khi quyết định nhận đơn.

**Independent Test**: Chuẩn bị các yêu cầu của hai nhà cung cấp, gồm bản nháp và yêu cầu đã gửi; kiểm tra danh sách riêng của từng đơn vị bằng cả hai vai trò.

**Acceptance Scenarios**:

1. **Given** admin hoặc staff có quyền xem, **When** mở danh sách, **Then** chỉ thấy yêu cầu đã được gửi đến nhà cung cấp của mình; không thấy bản nháp của trường hoặc đơn thuộc nhà cung cấp khác.
2. **Given** có yêu cầu ở nhiều trạng thái, **When** lọc trạng thái chờ tiếp nhận (`SENT`), **Then** chỉ thấy yêu cầu đang chờ tiếp nhận của đơn vị mình; kết quả được phân trang và cho biết còn trang tiếp theo hay không.
3. **Given** chưa có yêu cầu phù hợp, **When** xem danh sách, **Then** nhận danh sách trống và thông tin phân trang hợp lệ.
4. **Given** tài khoản không có quyền xem hiệu lực, **When** xem danh sách, **Then** bị từ chối kể cả khi có vai trò admin hoặc staff nhà cung cấp.

---

### User Story 2 - Xem chi tiết yêu cầu trước khi nhận (Priority: P1)

Là admin hoặc staff nhà cung cấp, tôi muốn xem trường gửi, ngày giao mong muốn, các nguyên liệu và số lượng yêu cầu để xác định khả năng cung ứng.

**Why this priority**: Chỉ mã đơn và trạng thái chưa đủ để xác nhận trách nhiệm cung cấp nguyên liệu.

**Independent Test**: Mở một yêu cầu đã gửi có nhiều nguyên liệu và ghi chú; đối chiếu nội dung với yêu cầu gốc của trường và thử mở bằng tài khoản nhà cung cấp khác.

**Acceptance Scenarios**:

1. **Given** yêu cầu đã gửi đến đơn vị mình và người dùng có quyền xem, **When** mở chi tiết, **Then** thấy mã yêu cầu, trạng thái, định danh và tên trường, ngày giao mong muốn, ghi chú, thời điểm gửi, danh sách nguyên liệu kèm số lượng, đơn vị và ghi chú từng dòng.
2. **Given** yêu cầu đã được tiếp nhận, **When** xem chi tiết, **Then** thấy thêm người tiếp nhận và thời điểm tiếp nhận; trường hợp dữ liệu cũ thiếu thông tin phải thể hiện chưa có thông tin, không tự suy đoán.
3. **Given** yêu cầu không tồn tại, còn nháp hoặc thuộc nhà cung cấp khác, **When** mở chi tiết, **Then** nhận thông báo không tìm thấy và không lộ nội dung yêu cầu.
4. **Given** yêu cầu có ngày giao hoặc ghi chú để trống, **When** xem chi tiết, **Then** vẫn xem được các thông tin còn lại và thể hiện các trường trống nhất quán.

---

### User Story 3 - Xác nhận tiếp nhận bởi admin hoặc staff (Priority: P1)

Là admin hoặc staff nhà cung cấp, tôi muốn xác nhận nhận yêu cầu đang chờ để nhà trường biết đơn vị đã tiếp nhận và có người chịu trách nhiệm cho lần nhận đó.

**Why this priority**: Đây là hành động nghiệp vụ chính, cần cùng khả năng sử dụng cho cả hai vai trò.

**Independent Test**: Lần lượt dùng admin và staff có quyền tiếp nhận để nhận hai yêu cầu đang chờ; kiểm tra trạng thái, danh tính và thời điểm tiếp nhận. Gửi lại thao tác và cho hai người nhận đồng thời để kiểm tra tính nhất quán.

**Acceptance Scenarios**:

1. **Given** yêu cầu ở `SENT`, tài khoản có quyền tiếp nhận, nhà cung cấp đang cho phép nhận đơn và admin của hai đơn vị không bị vô hiệu hóa, **When** admin hoặc staff xác nhận, **Then** yêu cầu chuyển sang `ACCEPTED` và ghi nhận đúng người thực hiện, thời điểm tiếp nhận.
2. **Given** yêu cầu đã ở `ACCEPTED` hoặc `IN_PROGRESS`, **When** người có quyền thuộc cùng nhà cung cấp xác nhận lại, **Then** nhận kết quả hiện có; không thay người nhận đầu tiên, thời điểm nhận hoặc trạng thái hiện tại.
3. **Given** hai người cùng xác nhận một yêu cầu đang chờ, **When** các thao tác được xử lý, **Then** chỉ một lần tiếp nhận được ghi nhận và cả hai nhận kết quả nhất quán với lần nhận đó.
4. **Given** nhà cung cấp đang tạm dừng nhận đơn hoặc admin của một trong hai đơn vị đã bị vô hiệu hóa, **When** tiếp nhận mới một yêu cầu `SENT`, **Then** bị từ chối với lý do phù hợp và yêu cầu giữ nguyên trạng thái.
5. **Given** yêu cầu đã hoàn thành hoặc bị hủy, **When** xác nhận tiếp nhận, **Then** bị từ chối vì trạng thái không cho phép, không ghi lại thông tin nhận.
6. **Given** người dùng bị thu hồi quyền hoặc đổi nhà cung cấp trước khi việc tiếp nhận được ghi nhận, **When** hoàn tất thao tác, **Then** hệ thống từ chối và không thay đổi yêu cầu.

### Edge Cases

- Nhà trường chưa gửi đơn: nhà cung cấp không xem được bản nháp và không thể tiếp nhận; thông báo không tìm thấy, không tiết lộ nội dung bản nháp.
- Nhà cung cấp không có yêu cầu hoặc trang vượt phạm vi: trả danh sách trống, không phát sinh lỗi nghiệp vụ.
- Trạng thái lọc, phân trang hoặc định danh yêu cầu không hợp lệ: báo lỗi đầu vào rõ ràng bằng tiếng Việt.
- Người dùng có quyền xem nhưng bị tắt quyền tiếp nhận: vẫn xem được đơn, không thể tiếp nhận.
- Người dùng có quyền tiếp nhận nhưng không có quyền xem: các thao tác danh sách và chi tiết vẫn bị từ chối; thao tác tiếp nhận kiểm tra quyền tiếp nhận độc lập như hiện hành.
- Người dùng giả mạo nhà cung cấp trong dữ liệu gửi lên: không thể thay đổi phạm vi truy cập gắn với tài khoản hiện tại.
- Mất kết nối sau khi nhận đơn thành công: thao tác thử lại trả thông tin đã nhận, không ghi đè người nhận.
- Supplier tạm dừng sau khi đã nhận đơn: vẫn được xem lịch sử theo quyền hiện hành; xác nhận lại `ACCEPTED`/`IN_PROGRESS` trả thông tin cũ, không bị coi là lần nhận mới.
- Nhà trường tạm dừng tạo đơn sau khi đã gửi: bản thân trạng thái tạm dừng tạo đơn của trường không ngăn nhà cung cấp nhận yêu cầu đã gửi hợp lệ.
- Yêu cầu bị hủy đồng thời với tiếp nhận: chỉ kết quả phù hợp với trạng thái cuối cùng được ghi nhận; không để lại thông tin tiếp nhận một phần do thao tác thất bại.
- Nguyên liệu đổi tên hoặc ngừng hoạt động sau khi gửi: vẫn hiển thị được dòng yêu cầu lịch sử, không tự sửa số lượng, đơn vị hoặc loại bỏ dòng.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cho phép hai vai trò admin nhà cung cấp (`INGREDIENT_SUPPLIER_ADMIN`) và staff nhà cung cấp (`INGREDIENT_SUPPLIER_STAFF`) sử dụng cùng luồng danh sách, chi tiết và tiếp nhận trong phạm vi đơn vị của mình, tùy quyền hiệu lực. Tài khoản phải đang hoạt động và có tư cách thành viên nhà cung cấp hợp lệ.
- **FR-002**: Hệ thống MUST yêu cầu quyền xem yêu cầu cung ứng (`supply_request.view`) cho danh sách và chi tiết, quyền tiếp nhận (`supply_request.accept`) cho xác nhận tiếp nhận. Vai trò đơn thuần không thay thế quyền; tài khoản thuộc vai trò hoặc loại tổ chức khác không được sử dụng luồng tiếp nhận của nhà cung cấp.
- **FR-003**: Hệ thống MUST xác định nhà cung cấp từ danh tính và tư cách thành viên hiện hành của người dùng; không cho phép dữ liệu người dùng nhập mở rộng phạm vi. Yêu cầu ngoài phạm vi, không tồn tại hoặc còn nháp được xử lý như không tìm thấy khi xem chi tiết hoặc tiếp nhận.
- **FR-004**: Danh sách MUST bao gồm các yêu cầu đã được gửi đến nhà cung cấp, mặc định gồm mọi trạng thái ngoài `DRAFT`; hỗ trợ lọc một trạng thái trong `SENT`, `ACCEPTED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. Mặc định 20 yêu cầu mỗi trang, tối đa 100; số trang và kích thước trang là số nguyên dương, có thông tin trang tiếp theo và thứ tự ổn định khi dữ liệu không đổi. Giá trị lọc không thuộc tập hỗ trợ phải bị từ chối.
- **FR-005**: Mỗi mục danh sách MUST có định danh yêu cầu, mã yêu cầu, định danh và tên trường gửi, trạng thái, ngày giao mong muốn, thời điểm gửi, thời điểm tiếp nhận nếu có và các mốc tạo/cập nhật hiện có. Không trả dữ liệu tài khoản hoặc hồ sơ không cần cho việc nhận đơn.
- **FR-006**: Chi tiết MUST bao gồm các thông tin ở FR-005, ghi chú yêu cầu và mọi dòng nguyên liệu với định danh dòng, định danh nguyên liệu của trường, tên nguyên liệu có thể tra cứu từ yêu cầu hiện có, số lượng yêu cầu, đơn vị và ghi chú dòng. Nội dung MUST phản ánh yêu cầu đã lưu; không thay đổi đơn hoặc suy diễn dữ liệu lịch sử không được lưu.
- **FR-007**: Chi tiết và kết quả tiếp nhận MUST thể hiện người nhận đầu tiên và thời điểm nhận nếu có. Không có thông tin được thể hiện bằng giá trị trống nhất quán; không suy đoán người nhận hoặc ngày nhận cho dữ liệu cũ. Không đưa số điện thoại, email hay dữ liệu xác thực của người nhận vào thông tin này.
- **FR-008**: Hệ thống MUST chỉ thực hiện lần tiếp nhận mới từ `SENT` sang `ACCEPTED`, ghi nhận người thực hiện và thời điểm do hệ thống xác định. Thao tác không yêu cầu nhập thêm trường nghiệp vụ, không sửa nội dung yêu cầu, không tự chuyển sang đang thực hiện hoặc tạo giao hàng/tồn kho.
- **FR-009**: Hệ thống MUST giữ quy tắc hiện hành: nhà cung cấp tạm dừng nhận đơn không nhận mới; admin trường hoặc admin nhà cung cấp bị vô hiệu hóa ngăn lần nhận mới. Tạm dừng tạo đơn của trường không tự ngăn nhận một yêu cầu đã gửi. Tạm dừng nhận đơn không tự khóa khả năng xem lịch sử khi quyền xem vẫn hợp lệ.
- **FR-010**: Hệ thống MUST trả lại thông tin tiếp nhận hiện có khi yêu cầu đã ở `ACCEPTED` hoặc `IN_PROGRESS`, sau khi xác minh quyền và phạm vi hiện hành; không ghi đè người nhận, thời điểm hoặc trạng thái, kể cả khi người thử lại khác người nhận đầu tiên trong cùng nhà cung cấp hoặc nhà cung cấp hiện tạm dừng nhận mới.
- **FR-011**: Hệ thống MUST từ chối tiếp nhận yêu cầu ở `COMPLETED` hoặc `CANCELLED` và không tạo tác động dữ liệu. Với bản nháp, áp dụng cách xử lý không tìm thấy tại FR-003.
- **FR-012**: Hệ thống MUST bảo đảm chỉ một lần chuyển trạng thái tiếp nhận cho một yêu cầu khi có thao tác đồng thời. Thay đổi trạng thái và thông tin người/thời điểm nhận phải cùng thành công hoặc cùng thất bại; thao tác thất bại không để lại dữ liệu nhận một phần.
- **FR-013**: Hệ thống MUST kiểm tra lại tài khoản, vai trò, quyền, tư cách thành viên, trạng thái yêu cầu và điều kiện nhận mới tại thời điểm ghi nhận. Quyền bị thu hồi hoặc phạm vi thay đổi trước thời điểm đó phải ngăn thao tác.
- **FR-014**: Hệ thống MUST trả thông báo tiếng Việt rõ ràng cho đầu vào sai, thiếu quyền, không tìm thấy, trạng thái không cho phép hoặc tạm dừng. Thông báo không lộ dữ liệu yêu cầu ngoài phạm vi hoặc thông tin nội bộ.
- **FR-015**: Tính năng MUST kế thừa yêu cầu cung ứng, quyền và thông tin tiếp nhận đã có; giữ hành vi tạo/gửi đơn của trường và hợp đồng kết quả tiếp nhận hiện hành. Không tạo bản sao đơn hàng hoặc một vòng đời tiếp nhận song song. Thay đổi hiển thị danh sách của nhà cung cấp không thay đổi quyền xem và phạm vi danh sách phía trường.

### Key Entities _(include if feature involves data)_

- **Yêu cầu cung ứng**: Yêu cầu của một trường gửi đến một nhà cung cấp; có mã, trạng thái, ngày giao mong muốn, ghi chú, thời điểm gửi và thông tin tiếp nhận.
- **Dòng nguyên liệu yêu cầu**: Nguyên liệu được trường yêu cầu, số lượng, đơn vị và ghi chú; thuộc đúng một yêu cầu cung ứng.
- **Người tiếp nhận**: Tài khoản admin hoặc staff nhà cung cấp thực hiện lần nhận thành công đầu tiên, được xác định từ danh tính hiện hành.
- **Nhà trường và nhà cung cấp**: Hai đơn vị gắn với yêu cầu; tư cách thành viên, trạng thái tài khoản quản trị và việc tạm dừng nhận đơn quyết định điều kiện tiếp nhận.
- **Quyền hiệu lực**: Quyền xem và quyền tiếp nhận được xác định từ quyền vai trò đang bật sau khi trừ quyền bị tắt cho từng người dùng.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Trong toàn bộ kịch bản chấp nhận, cả admin và staff có đủ quyền đều xem được yêu cầu đã gửi, mở chi tiết và tiếp nhận thành công mà không cần nhờ vai trò khác thực hiện hộ.
- **SC-002**: 100% lần truy cập bằng tài khoản nhà cung cấp khác, tài khoản không đủ quyền hoặc truy cập bản nháp đều bị chặn theo quy tắc đã nêu; không lộ nội dung yêu cầu.
- **SC-003**: Mỗi yêu cầu chỉ có một người và một thời điểm tiếp nhận đầu tiên sau các lần gửi lại hoặc xác nhận đồng thời; 100% lần thử lại hợp lệ giữ nguyên thông tin đó.
- **SC-004**: Người dùng xem được tất cả dòng nguyên liệu, số lượng và đơn vị của yêu cầu đã gửi trước khi nhận; 100% nội dung số lượng/đơn vị khớp yêu cầu đã lưu trong các kịch bản chấp nhận.
- **SC-005**: 100% lần nhận mới khi nhà cung cấp tạm dừng, admin một bên bị vô hiệu hóa hoặc đơn đã hủy/hoàn thành đều không thay đổi yêu cầu; các lần nhận hợp lệ ghi đủ trạng thái, người và thời điểm nhận.

## Assumptions

- “Admin và staff” là hai vai trò thuộc nhà cung cấp, không bao gồm quản trị hệ thống hay nhân sự nhà trường.
- “Tiếp nhận” được hiểu là xác nhận nhận toàn bộ yêu cầu đã gửi. Từ chối, nhận một phần, thương lượng số lượng/giá, thêm ghi chú phản hồi, hủy, bắt đầu xử lý, hoàn thành và lập giao hàng nằm ngoài phạm vi lần này.
- Danh sách và chi tiết là phần hỗ trợ cần thiết để tiếp nhận. Bộ lọc lần này giới hạn ở trạng thái; tìm kiếm nâng cao, thống kê và thông báo ngoài hệ thống không thuộc phạm vi.
- Đây là đặc tả hoàn thiện tính năng phía nhà cung cấp dựa trên luồng tiếp nhận và quyền đã có. Phụ thuộc dữ liệu yêu cầu do trường tạo/gửi và cơ chế phân quyền, tạm dừng/vô hiệu hóa hiện hành.
- Không yêu cầu tạo mới tài khoản, tự bật lại quyền bị tắt hoặc thay đổi quyền của người dùng đang có để bảo đảm mọi tài khoản đều được tiếp nhận.
- Tên nguyên liệu được tra cứu từ dữ liệu hiện có; không cam kết tên lịch sử bất biến khi hệ thống chưa lưu ảnh chụp tên tại thời điểm gửi.
- Phạm vi là nghiệp vụ backend để ứng dụng sử dụng; thiết kế và xây dựng màn hình sẽ được đặc tả riêng nếu có yêu cầu.
