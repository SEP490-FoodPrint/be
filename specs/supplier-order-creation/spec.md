# Feature Specification: Nhà cung cấp tạo đơn từ yêu cầu hoặc tạo độc lập

**Feature Branch**: `feat/supplier-order-creation`

**Created**: 2026-11-14

**Status**: Clarified — Sẵn sàng lập kế hoạch

**Input**: User description: "tôi muốn nhà cung cấp tạo được đơn hàng dựa trên đơn yêu cầu mà nhà cung cấp nhận được từ nhà trường"

## Clarifications

### Session 2026-11-15

- Q: Nhà cung cấp chỉ tạo đơn từ yêu cầu đã tiếp nhận hay có thể tạo độc lập? → A: Hỗ trợ cả hai cách: tạo từ yêu cầu đã tiếp nhận và tạo độc lập không bắt buộc có yêu cầu nguồn.
- Q: Một yêu cầu được tạo một đơn toàn bộ hay chia nhiều đơn từng phần? → A: Q2 = A, một yêu cầu tạo một đơn chứa toàn bộ nguyên liệu và đúng toàn bộ số lượng yêu cầu; không chia đơn từ yêu cầu thành từng phần.
- Q: Nhu cầu đơn độc lập phát sinh từ đâu? → A: Phát sinh khi đơn giao trước bị yêu cầu giao lại; đây là mục đích sử dụng, không tự biến lịch sử từ chối thành điều kiện bắt buộc để tạo đơn độc lập.
- Q: Có chuyển cơ chế đơn độc lập thành chỉ tạo phiếu thay thế từ đơn bị từ chối không? → A: Giữ nguyên cơ chế tạo đơn độc lập; không bắt buộc liên kết yêu cầu nguyên liệu hoặc phiếu giao trước. Các giới hạn một phiếu thay thế cho một lần từ chối không áp vào cơ chế này.
- Q: Đơn độc lập có bắt buộc bên nhận không và chọn từ đâu? → A: Có. Bắt buộc chọn một trường mà nhà cung cấp đã liên kết. Từ “nguồn cung” trong câu trả lời này chỉ trường được chọn làm bên nhận, không phải cơ sở nguồn cung nguyên liệu.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Tạo đơn từ yêu cầu đã tiếp nhận (Priority: P1)

Là admin hoặc staff nhà cung cấp có quyền phù hợp, tôi muốn tạo một đơn giao hàng chứa toàn bộ nội dung yêu cầu đã tiếp nhận để thực hiện cung ứng cho trường.

**Why this priority**: Nối bước tiếp nhận với thực hiện đơn, tránh nhập lại hoặc thay sai đối tác, nguyên liệu và số lượng.

**Independent Test**: Dùng cả hai vai trò tạo từ hai yêu cầu khác nhau; đối chiếu đủ dòng và đúng số lượng gốc, rồi thử tạo đơn thứ hai cho cùng yêu cầu.

**Acceptance Scenarios**:

1. **Given** yêu cầu đã tiếp nhận thuộc nhà cung cấp mình và chưa được dùng tạo đơn, **When** tạo đơn từ yêu cầu, **Then** trường nhận, nhà cung cấp và toàn bộ nguyên liệu/số lượng/đơn vị được kế thừa từ yêu cầu đã lưu.
2. **Given** nội dung hợp lệ, **When** xác nhận, **Then** tạo một đơn có mã riêng, trạng thái mới tạo, người/thời điểm tạo và liên kết yêu cầu gốc; yêu cầu chuyển từ đã tiếp nhận sang đang thực hiện trong cùng thao tác.
3. **Given** người dùng bỏ dòng, đổi nguyên liệu/đơn vị hoặc thay lượng so với yêu cầu, **When** xác nhận, **Then** bị từ chối và không tạo đơn sai hoặc thiếu nội dung.
4. **Given** yêu cầu đã có đơn, **When** cố tạo thêm đơn từ cùng yêu cầu, **Then** bị chặn; gửi lại cùng thao tác phải nhận diện được kết quả đã tạo.
5. **Given** yêu cầu chưa tiếp nhận, đã hoàn thành hoặc đã hủy, **When** tạo từ yêu cầu, **Then** bị từ chối và không thay đổi dữ liệu.
6. **Given** yêu cầu ngoài nhà cung cấp hoặc không tồn tại, **When** tạo đơn, **Then** trả cùng loại thông báo không tìm thấy.

---

### User Story 2 - Tạo đơn độc lập cho trường đã liên kết (Priority: P1)

Là admin hoặc staff nhà cung cấp có quyền phù hợp, tôi muốn chọn một trường đã liên kết, chọn nguyên liệu và nhập số lượng để tạo đơn độc lập, kể cả khi cần chủ động giao lại mà không có yêu cầu mới từ trường.

**Why this priority**: Cho phép nhà cung cấp chủ động lập đơn theo nhu cầu thực tế mà vẫn xác định đúng trường nhận và quyền sở hữu nguyên liệu.

**Independent Test**: Khi không có yêu cầu nguyên liệu hoặc phiếu bị từ chối làm nguồn, dùng cả hai vai trò tạo đơn cho trường đã liên kết; thử bỏ trường nhận, chọn trường chưa liên kết và chọn nguyên liệu của nhà cung cấp khác.

**Acceptance Scenarios**:

1. **Given** nhà cung cấp có trường đã liên kết đủ điều kiện cung ứng hiện hành, **When** chọn tạo độc lập, **Then** người dùng phải chọn một trường từ danh sách đó; không bắt buộc chọn yêu cầu nguyên liệu hay phiếu giao trước.
2. **Given** đã chọn trường hợp lệ, nguyên liệu thuộc nhà cung cấp và số lượng/đơn vị hợp lệ, **When** xác nhận, **Then** tạo đơn độc lập có mã riêng, trạng thái mới tạo, người/thời điểm tạo; không tạo yêu cầu nhà trường giả hoặc sửa một yêu cầu không liên quan.
3. **Given** không chọn trường hoặc chọn trường chưa liên kết/không còn được phép cung ứng, **When** xác nhận, **Then** bị từ chối và không tạo đơn.
4. **Given** nguyên liệu ngoài phạm vi, dòng trùng, đơn rỗng hoặc số lượng không dương, **When** xác nhận, **Then** báo rõ nội dung sai và không lưu đơn dở dang.
5. **Given** không có yêu cầu nguyên liệu hoặc lịch sử giao bị từ chối, **When** tạo độc lập với nội dung hợp lệ, **Then** vẫn tạo thành công.
6. **Given** người dùng có ý định lập hai đơn độc lập riêng biệt có cùng trường/nguyên liệu, **When** xác nhận từng thao tác, **Then** không bị giới hạn một đơn do quy tắc Q2; chỉ thao tác gửi lại cùng lần tạo mới phải chống trùng.

---

### User Story 3 - Xem lại kết quả và tránh tạo trùng (Priority: P2)

Là admin hoặc staff có quyền xem, tôi muốn xem đơn đã tạo, phân biệt đơn từ yêu cầu với đơn độc lập và tránh bản sao khi thao tác được gửi lại.

**Why this priority**: Xác định được kết quả tạo và nguồn đơn giúp xử lý đúng việc khi kết nối gián đoạn hoặc nhiều nhân viên cùng thao tác.

**Independent Test**: Tạo đơn theo cả hai cách, xem danh sách/chi tiết bằng hai vai trò, thử gửi lại và thử hai người cùng tạo từ một yêu cầu.

**Acceptance Scenarios**:

1. **Given** có đơn theo cả hai cách, **When** xem danh sách hoặc chi tiết, **Then** thấy cách tạo, mã/trạng thái, trường nhận, dòng nguyên liệu/lượng/đơn vị, người/thời điểm tạo; liên kết yêu cầu chỉ có ở đơn từ yêu cầu.
2. **Given** thao tác đã tạo thành công nhưng người dùng chưa nhận kết quả, **When** gửi lại cùng thao tác, **Then** không tạo thêm bản sao và xác định được kết quả đã có.
3. **Given** hai người cùng tạo từ một yêu cầu, **When** ghi nhận kết quả, **Then** chỉ có một đơn liên kết yêu cầu đó, không lưu thiếu dòng hoặc thiếu nguồn.
4. **Given** người dùng không có quyền xem hoặc thuộc nhà cung cấp khác, **When** xem đơn, **Then** bị chặn theo quyền/phạm vi hiện hành.

### Edge Cases

- Không có yêu cầu nguồn không ngăn tạo độc lập; thiếu trường nhận hoặc trường không thuộc tập đã liên kết hợp lệ phải ngăn tạo độc lập.
- Danh sách trường liên kết rỗng: hiển thị không có trường phù hợp và không cho xác nhận tạo độc lập.
- Trường liên kết hợp lệ khi mở form nhưng quan hệ đổi trước khi ghi nhận: xác minh lại và từ chối nếu không còn được phép tạo độc lập.
- Nhà cung cấp luôn lấy từ tài khoản hiện hành; không cho giả mạo tổ chức hoặc chọn nguyên liệu thuộc đơn vị khác.
- Đơn từ yêu cầu phải giữ nguyên trường, toàn bộ nguyên liệu/số lượng/đơn vị nguồn; đơn độc lập không bị giới hạn lượng bởi một yêu cầu không liên quan.
- Quyền, membership hoặc trạng thái nguồn thay đổi trong lúc tạo: kiểm tra lại trước khi ghi; lỗi giữa chừng không để lại đơn thiếu dòng.
- Tạo độc lập để giao lại không tự sửa đơn cũ, xóa quyết định kiểm nhận, khôi phục yêu cầu bị hủy hoặc đặt lại bộ đếm của yêu cầu cũ.
- Tạo đơn chưa tự xác nhận đến nơi, được duyệt, trường đã nhận hoặc làm thay đổi tồn kho.
- Supplier tạm dừng nhận yêu cầu mới: xử lý đơn từ yêu cầu đã tiếp nhận theo chính sách công việc đã nhận; việc lập đơn độc lập kiểm tra điều kiện cung ứng mới và quyền hiện hành, không coi đó là cách bỏ qua tạm dừng.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cho admin và staff nhà cung cấp đang hoạt động, có membership hợp lệ và quyền tạo hiệu lực sử dụng hai cách tạo: từ yêu cầu đã tiếp nhận hoặc tạo độc lập. Quyền xem/tiếp nhận không tự thay thế quyền tạo.
- **FR-002**: Đơn từ yêu cầu MUST xuất phát từ yêu cầu đã tiếp nhận, còn được phép thực hiện và chưa được dùng tạo đơn. Không dùng yêu cầu chưa tiếp nhận, đã hoàn thành hoặc đã hủy. Đơn độc lập không bắt buộc có yêu cầu hoặc phiếu giao trước và không yêu cầu lịch sử bị từ chối.
- **FR-003**: Nhà cung cấp MUST được xác định từ tài khoản hiện hành. Đơn từ yêu cầu kế thừa trường nhận từ yêu cầu hợp lệ; đơn độc lập MUST chọn đúng một trường nhà cung cấp đã liên kết và được phép cung ứng theo chính sách quan hệ hiện hành. Không cho tự nhập bên nhận ngoài tập được phép.
- **FR-004**: Mỗi đơn MUST có mã/định danh duy nhất do hệ thống sinh, cách tạo, trạng thái, trường nhận và người/thời điểm tạo. Chỉ đơn từ yêu cầu bắt buộc liên kết yêu cầu gốc. Đơn độc lập được tạo không có liên kết yêu cầu, không phát sinh yêu cầu nhà trường giả để đáp ứng liên kết.
- **FR-005**: Đơn từ yêu cầu MUST chứa đủ toàn bộ dòng, giữ đúng nguyên liệu/đơn vị/toàn bộ số lượng nguồn. Đơn độc lập cho người tạo chọn nguyên liệu của nhà cung cấp hiện hành, nhập số lượng dương và đơn vị hợp lệ; không cho đơn rỗng hoặc trùng nguyên liệu trong một đơn.
- **FR-006**: Đơn được tạo phục vụ giao hàng cho trường. Tạo thành công bắt đầu ở trạng thái mới tạo, không tự đánh dấu đã giao/duyệt/nhận hoặc hoàn thành. Với đơn từ yêu cầu, chuyển yêu cầu đã tiếp nhận sang đang thực hiện trong cùng thao tác. Có thể nhập thời điểm giao dự kiến, thông tin phương tiện và ghi chú nếu có.
- **FR-007**: Một yêu cầu MUST chỉ tạo một đơn chứa toàn bộ nội dung theo Q2 = A; không chia đơn từng phần hoặc tạo thêm từ cùng yêu cầu. Quy tắc này chỉ áp dụng cho cách tạo từ yêu cầu, không giới hạn số đơn độc lập có ý định tạo riêng biệt.
- **FR-008**: Người có quyền xem trong nhà cung cấp MUST xem được danh sách phân trang và chi tiết cả hai cách tạo, nhận diện trường nhận và nguồn nếu có. Không trả dữ liệu ngoài phạm vi hoặc hồ sơ tài khoản nhạy cảm.
- **FR-009**: Tạo đơn, các dòng, liên kết nguồn nếu có và thay đổi trạng thái liên quan MUST cùng thành công hoặc cùng thất bại. Không để lại dữ liệu thiếu dòng; đơn độc lập không tự làm thay đổi yêu cầu hoặc phiếu giao trước không liên quan.
- **FR-010**: Hệ thống MUST kiểm tra lại actor, role, quyền, membership và nội dung trước khi ghi nhận. Đơn từ yêu cầu kiểm tra lại trạng thái và giới hạn một đơn; đơn độc lập kiểm tra lại quan hệ với trường và quyền sở hữu nguyên liệu. Gửi lại cùng thao tác không tạo bản sao; tạo đồng thời từ cùng một yêu cầu không được sinh hai đơn.
- **FR-011**: Hệ thống MUST giữ phân quyền/cô lập tổ chức, điều kiện tiếp nhận và công việc đã nhận hiện hành. Tạo độc lập không tự sửa lịch sử kiểm nhận, nhập kho, yêu cầu đã hủy hoặc bộ đếm từ chối của đơn cũ. Tài khoản hệ thống hoặc nhà trường không có quyền ngầm tạo thay nhà cung cấp.
- **FR-012**: Hệ thống MUST báo lỗi tiếng Việt rõ ràng cho trường nhận, nguyên liệu, số lượng hoặc nguồn sai, thiếu quyền và xung đột trạng thái; không lộ nội dung ngoài phạm vi. Nguồn không tồn tại/ngoài phạm vi trả cùng loại thông báo không tìm thấy.
- **FR-013**: Nội dung đơn độc lập MUST do người tạo nhập từ danh mục nguyên liệu của nhà cung cấp và trường nhận đã liên kết. Không bắt buộc sao chép toàn bộ hoặc một phần phiếu bị từ chối. Nhu cầu giao lại là một trường hợp sử dụng cơ chế tạo độc lập; không tự thêm ràng buộc mỗi phiếu bị từ chối chỉ có một phiếu thay thế hoặc bắt buộc liên kết phiếu cũ.

### Key Entities _(include if feature involves data)_

- **Yêu cầu nguyên liệu gốc**: Nguồn của cách tạo từ yêu cầu; xác định trường nhận và toàn bộ nguyên liệu/số lượng/đơn vị, tạo tối đa một đơn.
- **Đơn giao hàng**: Thuộc một nhà cung cấp, bắt buộc một trường nhận; có hai cách tạo. Liên kết yêu cầu gốc có ở đơn từ yêu cầu, không bắt buộc ở đơn độc lập.
- **Dòng đơn**: Nguyên liệu, đơn vị và số lượng; đơn từ yêu cầu phải khớp dòng nguồn, đơn độc lập chọn nguyên liệu của nhà cung cấp hiện hành.
- **Quan hệ nhà cung cấp–trường**: Xác định các trường đủ điều kiện được chọn khi tạo độc lập; phải được kiểm tra lại khi ghi nhận.
- **Người lập đơn**: Admin hoặc staff nhà cung cấp có quyền phù hợp, được ghi nhận từ danh tính hiện hành.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Cả admin và staff đủ quyền đều tạo và xem lại được đơn theo cả hai cách; đơn độc lập tạo thành công khi không có yêu cầu nguồn hoặc phiếu bị từ chối.
- **SC-002**: 100% đơn từ yêu cầu có đầy đủ và đúng nguyên liệu/đơn vị/toàn bộ số lượng nguồn; 100% đơn độc lập có trường nhận thuộc tập đã liên kết được phép và nguyên liệu thuộc nhà cung cấp.
- **SC-003**: 100% tình huống thiếu trường nhận, chọn trường chưa liên kết, sai quyền/phạm vi, nguyên liệu hoặc số lượng không hợp lệ bị chặn mà không lưu đơn dở dang.
- **SC-004**: Sau gửi lại hoặc thao tác đồng thời, mỗi yêu cầu có tối đa một đơn từ yêu cầu; không sinh bản sao từ cùng thao tác ở cả hai cách tạo, nhưng các ý định tạo đơn độc lập riêng biệt vẫn được phép.
- **SC-005**: Tạo đơn độc lập không sửa dữ liệu yêu cầu/phiếu giao cũ, quyết định kiểm nhận hay lịch sử kho trong toàn bộ kịch bản chấp nhận.

## Assumptions

- Kế thừa hai vai trò admin/staff của nhà cung cấp; mọi thao tác phụ thuộc quyền hiệu lực hiện hành.
- “Đơn độc lập” là không bắt buộc yêu cầu nguyên liệu/phiếu giao trước; vẫn bắt buộc trường nhận đã liên kết. Không nhầm trường nhận với cơ sở nguồn cung nguyên liệu.
- Trường được chọn tuân thủ chính sách quan hệ hiện hành; mặc định chỉ quan hệ đang ACTIVE đủ điều kiện tạo đơn độc lập mới. Không áp điều kiện này hồi tố để tự thay đổi đơn từ yêu cầu đã tiếp nhận.
- Đơn độc lập không tự động được coi là lần thay thế trong chuỗi giao lại của yêu cầu cũ. Chức năng tạo độc lập không thay đổi quy tắc kiểm nhận hoặc bộ đếm hiện có; việc gắn nó với một chuỗi giao lại tự động cần đặc tả riêng nếu được yêu cầu.
- Cách lưu đơn không có yêu cầu nguồn và cách đưa loại đơn này vào luồng giao/kiểm nhận là phần thiết kế phải xử lý rõ ở bước plan, dựa trên đối tượng bắt buộc là trường nhận và dòng nguyên liệu; không được tạo yêu cầu giả hoặc thay quy tắc hiện hành ngoài phạm vi.
- Phạm vi gồm tạo, danh sách và chi tiết. Sửa/xóa/hủy thủ công, báo giá, thuế, thanh toán, hóa đơn, xuất phát vận chuyển và thay đổi quy tắc kiểm nhận không được tự bổ sung.
