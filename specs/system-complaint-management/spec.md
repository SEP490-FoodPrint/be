# Feature Specification: System Admin quản lý khiếu nại gửi tới hệ thống

**Feature Branch**: `feat/system-complaint-management`

**Created**: 2026-11-17

**Status**: Paused — tạm dừng theo yêu cầu ngày 2026-11-17, chờ thiết kế DB mới; chưa tiếp tục lập kế hoạch hoặc triển khai

**Input**: User description: "là system admin tôi muốn xem được danh sách, xem chi tiết, phản hồi khiếu nại từ tất cả vai trò trong hệ thống, mã complaintCode với cú pháp là FP-CP-00001"

## Clarifications

### Session 2026-11-17

- Q: System Admin sẽ xử lý nhóm khiếu nại nào? → A: Chọn A — khiếu nại gửi trực tiếp tới System Admin từ bất kỳ vai trò nào; tách khỏi khiếu nại suất ăn gửi Ban Giám hiệu và khiếu nại nguyên liệu gửi nhà cung cấp hiện có.

- Q: Các luồng khiếu nại nào cần được phân biệt trong bối cảnh toàn hệ thống? → A: Người dùng xác nhận sáu luồng: giáo viên → Ban Giám hiệu; Ban Giám hiệu → nhà cung cấp; phụ huynh → Ban Giám hiệu; Ban Giám hiệu → cán bộ ATTP; phụ huynh không hài lòng với phản hồi của Ban Giám hiệu → cán bộ ATTP; và mọi vai trò → System Admin. Luồng cuối là phạm vi tính năng hiện tại; các luồng còn lại là ngữ cảnh liên quan, không tự động được đưa vào danh sách hoặc quyền phản hồi của tính năng này.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Xem danh sách khiếu nại gửi tới System Admin (Priority: P1)

Là System Admin có quyền xem, tôi muốn xem danh sách khiếu nại gửi trực tiếp tới hệ thống từ mọi vai trò, thuộc mọi tổ chức, để biết các vấn đề cần xử lý mà không phải chuyển sang từng trường hoặc nhà cung cấp.

**Why this priority**: Danh sách là điểm tiếp nhận công việc tập trung và giúp phân biệt các khiếu nại chờ phản hồi với các khiếu nại đã được xử lý.

**Independent Test**: Chuẩn bị khiếu nại gửi trực tiếp tới System Admin từ từng vai trò hiện có và từ nhiều tổ chức, đồng thời có khiếu nại suất ăn/nguyên liệu và đơn gửi cán bộ ATTP; kiểm tra danh sách chứa đúng các khiếu nại gửi tới hệ thống và phân trang đầy đủ.

**Acceptance Scenarios**:

1. **Given** tài khoản System Admin đang hoạt động và có quyền xem, **When** xem danh sách, **Then** nhận được các khiếu nại gửi trực tiếp tới System Admin từ mọi vai trò và tổ chức, gồm cả đơn chưa phản hồi và đã phản hồi.
2. **Given** một khiếu nại do người thuộc trường hoặc nhà cung cấp gửi tới System Admin, **When** xem danh sách, **Then** thấy định danh, complaintCode, tiêu đề, người gửi, vai trò và tổ chức gắn với lần gửi nếu có, trạng thái, thời điểm gửi và thời điểm phản hồi nếu có.
3. **Given** có khiếu nại suất ăn gửi Ban Giám hiệu, khiếu nại nguyên liệu gửi nhà cung cấp hoặc đơn gửi cán bộ ATTP, **When** xem danh sách của tính năng này, **Then** các đơn đó không được tự động đưa vào hoặc sao chép thành khiếu nại gửi System Admin.
4. **Given** dữ liệu nhiều hơn một trang và không thay đổi trong lúc duyệt, **When** chuyển qua các trang, **Then** thấy đơn mới nhất trước, thứ tự ổn định khi trùng thời điểm, không trùng hoặc mất đơn; danh sách rỗng hoặc trang vượt cuối là kết quả hợp lệ.
5. **Given** người dùng chưa đăng nhập, tài khoản không còn hoạt động, không phải System Admin hoặc thiếu quyền xem, **When** yêu cầu danh sách, **Then** không đọc được dữ liệu dù tự cung cấp vai trò hoặc tổ chức khác.

---

### User Story 2 - Xem đầy đủ một khiếu nại (Priority: P1)

Là System Admin có quyền xem, tôi muốn đọc nội dung đầy đủ, biết ai gửi và xem câu trả lời đã lưu của một khiếu nại gửi tới hệ thống để có đủ ngữ cảnh xử lý.

**Why this priority**: Nội dung đầy đủ và thông tin người gửi giúp trả lời đúng vấn đề, tránh nhầm đơn giữa nhiều vai trò hoặc tổ chức.

**Independent Test**: Mở trực tiếp một khiếu nại đã biết định danh, không phụ thuộc thao tác danh sách; kiểm tra nội dung trước và sau phản hồi, thông tin người gửi và mã đối chiếu.

**Acceptance Scenarios**:

1. **Given** một khiếu nại chưa phản hồi gửi trực tiếp tới System Admin, **When** System Admin có quyền xem mở chi tiết, **Then** thấy toàn bộ mô tả, thông tin danh sách, thời điểm cập nhật và trạng thái chưa có phản hồi.
2. **Given** khiếu nại đã được System Admin phản hồi, **When** đọc chi tiết, **Then** thấy đúng nội dung, tài khoản thực sự phản hồi và thời điểm phản hồi trên cùng định danh và complaintCode gốc.
3. **Given** người gửi đã bị khóa hoặc chuyển vai trò/tổ chức sau khi gửi, **When** đọc lại đơn, **Then** đơn vẫn tồn tại trong phạm vi hệ thống và giữ thông tin vai trò/tổ chức gắn với lần gửi, không bị chuyển thành đơn của tổ chức mới.
4. **Given** định danh không tồn tại hoặc thuộc luồng khiếu nại suất ăn/nguyên liệu hay gửi cán bộ ATTP, **When** dùng nó để mở chi tiết tại tính năng này, **Then** nhận thông báo không tìm thấy khiếu nại gửi tới hệ thống; không đọc xuyên sang luồng khác.
5. **Given** người dùng không phải System Admin hoặc thiếu quyền xem, **When** biết định danh hoặc complaintCode của đơn, **Then** vẫn không được đọc chi tiết.

---

### User Story 3 - Gửi phản hồi chính thức (Priority: P1)

Là System Admin có cả quyền xem và quyền phản hồi, tôi muốn trả lời một khiếu nại gửi trực tiếp tới hệ thống để ghi nhận câu trả lời chính thức, có người và thời điểm chịu trách nhiệm.

**Why this priority**: Phản hồi hoàn tất phần xử lý của quản trị viên và phải được lưu nhất quán, không bị ghi đè khi nhiều quản trị viên cùng xử lý.

**Independent Test**: Gửi phản hồi cho một đơn chưa phản hồi bằng định danh đã biết, đọc lại chi tiết, thử gửi lần hai và gửi đồng thời; xác nhận chỉ có một câu trả lời chính thức.

**Acceptance Scenarios**:

1. **Given** khiếu nại chưa phản hồi và System Admin đang hoạt động có đủ cả hai quyền, **When** gửi nội dung hợp lệ, **Then** hệ thống lưu nội dung, người và thời điểm phản hồi, chuyển đơn sang đã phản hồi và trả lại thông tin đã lưu.
2. **Given** nội dung chỉ có khoảng trắng, rỗng hoặc dài hơn 5.000 ký tự sau khi bỏ khoảng trắng hai đầu, **When** gửi phản hồi, **Then** nhận lỗi tiếng Việt chỉ rõ trường vi phạm và đơn không thay đổi; nội dung đúng 5.000 ký tự được chấp nhận.
3. **Given** System Admin chỉ có quyền xem hoặc chỉ có quyền phản hồi, **When** gửi câu trả lời, **Then** bị từ chối vì phải có đồng thời cả hai quyền.
4. **Given** khiếu nại đã phản hồi hoặc hai System Admin cùng phản hồi một đơn chưa phản hồi, **When** xử lý các yêu cầu, **Then** chỉ một câu trả lời chính thức được chấp nhận; yêu cầu còn lại nhận thông báo xung đột, không ghi đè kết quả trước.
5. **Given** tài khoản bị khóa, đổi vai trò hoặc mất một trong hai quyền trước thời điểm chấp nhận ghi, **When** hệ thống kiểm tra lại thẩm quyền, **Then** không lưu câu trả lời dưới danh nghĩa người không còn đủ quyền.
6. **Given** yêu cầu cố đặt người phản hồi, thời điểm, trạng thái, định danh hoặc complaintCode, **When** gửi, **Then** bị từ chối; phản hồi chỉ nhận nội dung văn bản và không cho mạo danh hoặc sửa mã.
7. **Given** thao tác lưu gặp sự cố, **When** chưa thể hoàn tất toàn bộ thay đổi, **Then** không để lại đơn đã phản hồi nhưng thiếu nội dung/người/thời điểm; nếu mất xác nhận sau khi đã lưu, việc đọc lại cho thấy kết quả đã chấp nhận.

### Edge Cases

- Người gửi thuộc nhóm hệ thống không gắn với một trường hoặc nhà cung cấp: thể hiện tổ chức là chưa có, không tự gán tổ chức hoặc bịa mã hiển thị.
- Người gửi có tên giống nhau nhưng khác tài khoản hoặc tổ chức: phân biệt bằng định danh, không gộp đơn theo tên, email hoặc vai trò.
- Người gửi hoặc tổ chức không còn hoạt động; tổ chức đã thay đổi sau khi gửi: vẫn xử lý đơn lịch sử và giữ ngữ cảnh của lần gửi.
- System Admin tự gửi một khiếu nại trong luồng gửi tới hệ thống: vai trò người gửi không tự làm đơn bị loại khỏi danh sách; người thực hiện phản hồi vẫn phải có đủ quyền hiện tại.
- Một nội dung tương tự đã xuất hiện trong luồng suất ăn/nguyên liệu: không tự đồng bộ, chuyển trách nhiệm hoặc phản hồi thay Ban Giám hiệu/nhà cung cấp.
- Mã FP-CP-00001 đã tồn tại ở khiếu nại nguyên liệu: không cấp lại mã đó cho một khiếu nại gửi tới hệ thống; cùng tiền tố phải giữ khả năng đối chiếu duy nhất.
- Sau FP-CP-99999, số thứ tự tiếp tục thành FP-CP-100000; không quay về đầu, cắt bớt chữ số hoặc tái sử dụng mã. Không yêu cầu dãy số liên tục không có khoảng trống.
- Đơn cũ chưa có mã: cần phương án tương thích trước khi đưa vào tính năng; không tạo mã tạm từ định danh hoặc cấp số khi xem/phản hồi.
- Nội dung tiếng Việt, xuống dòng và ký tự ngoài bảng chữ cái thông thường: giới hạn tính theo ký tự Unicode, không theo số byte; giữ nguyên nội dung bên trong sau khi bỏ khoảng trắng hai đầu và chỉ coi là văn bản.
- Nhiều đơn có cùng thời điểm gửi; trang cuối, trang rỗng hoặc tham số phân trang sai: thứ tự phải ổn định, dữ liệu sai nhận thông báo rõ ràng bằng tiếng Việt.
- Yêu cầu lặp sau mất kết nối hoặc nhiều quản trị viên cùng gửi: không tạo bản sao đơn hoặc ghi đè câu trả lời đã được chấp nhận.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST chỉ cho tài khoản System Admin đang hoạt động sử dụng các thao tác quản trị trong tính năng theo quyền hiệu lực hiện tại. Vai trò System Admin MUST không tự động thay thế kiểm tra quyền; các vai trò khác không được sử dụng các thao tác này dù biết định danh đơn.
- **FR-002**: Xem danh sách/chi tiết MUST yêu cầu quyền xem khiếu nại gửi tới hệ thống. Phản hồi MUST đồng thời yêu cầu quyền xem và quyền phản hồi của chính luồng này; không dùng quyền của luồng suất ăn/nguyên liệu để thay thế. Các thay đổi hiệu lực quyền và trạng thái tài khoản MUST được áp dụng theo cơ chế phân quyền hiện hành.
- **FR-003**: Phạm vi MUST là khiếu nại gửi trực tiếp tới System Admin từ bất kỳ vai trò nào trong hệ thống và mọi tổ chức, kể cả người gửi không gắn với trường/nhà cung cấp. Tính năng MUST tách biệt với khiếu nại của giáo viên/phụ huynh gửi Ban Giám hiệu, khiếu nại nguyên liệu của Ban Giám hiệu gửi nhà cung cấp, đơn của Ban Giám hiệu gửi cán bộ ATTP và đơn phụ huynh gửi cán bộ ATTP sau khi không hài lòng với phản hồi của Ban Giám hiệu; không tự đưa các đơn đó vào phạm vi quản trị này. Việc dùng chung cấu trúc lưu trữ nếu được chọn khi lập kế hoạch MUST không làm gộp phạm vi đọc hoặc quyền phản hồi giữa các luồng.
- **FR-004**: Danh sách MUST bao gồm đơn chưa phản hồi và đã phản hồi, không giới hạn ở một người gửi, vai trò hoặc tổ chức; phân trang với thứ tự thời điểm gửi giảm dần và định danh làm thứ tự phụ ổn định. Khi dữ liệu không đổi, duyệt hết các trang MUST không trùng hoặc bỏ sót đơn. Danh sách rỗng và trang vượt cuối MUST là kết quả hợp lệ.
- **FR-005**: Mỗi mục danh sách MUST có định danh, complaintCode, tiêu đề, định danh/tên người gửi, vai trò và tổ chức gắn với lần gửi nếu có, trạng thái, thời điểm gửi và thời điểm phản hồi nếu có. Không có tổ chức MUST được biểu diễn là chưa có, không suy đoán từ người đang xem.
- **FR-006**: Chi tiết MUST bổ sung toàn bộ mô tả, thời điểm cập nhật, nội dung phản hồi, định danh/tên người phản hồi và thời điểm phản hồi nếu có. Đơn chưa được phản hồi MUST thể hiện các thông tin phản hồi là chưa có. Thông tin đăng nhập, bí mật và liên hệ cá nhân không cần thiết MUST không được cung cấp.
- **FR-007**: Khiếu nại MUST có complaintCode duy nhất, bất biến, dạng FP-CP-00001: tiền tố FP-CP- và số nguyên dương được thêm số 0 bên trái cho đủ tối thiểu năm chữ số. Mã MUST được cấp/lưu một lần ở luồng tạo đơn, giữ nguyên khi xem hoặc phản hồi; sau 99999 MUST tiếp tục tăng số chữ số. Trong toàn bộ các luồng dùng cùng tiền tố FP-CP-, hai khiếu nại độc lập MUST không được trùng mã. Không yêu cầu số thứ tự không có khoảng trống.
- **FR-008**: Hệ thống MUST giữ định danh UUID riêng bên cạnh complaintCode theo quy ước đã chốt trước đó; thao tác chi tiết/phản hồi tiếp tục xác định đơn bằng UUID. Mã nghiệp vụ MUST không thay thế kiểm tra quyền, không suy ra từ UUID, không cấp lại lúc xem/phản hồi và không do người phản hồi tự đặt.
- **FR-009**: System Admin đủ quyền MUST được gửi một câu trả lời văn bản chính thức cho đơn chưa phản hồi, chuyển từ chưa phản hồi sang đã phản hồi khi thành công. Nội dung MUST có từ 1 đến 5.000 ký tự Unicode sau khi bỏ khoảng trắng hai đầu, giữ nguyên xuống dòng bên trong; không nhận tệp đính kèm trong thao tác này.
- **FR-010**: Nội dung, tài khoản thực sự phản hồi, thời điểm và trạng thái mới MUST được lưu cùng nhau trên cùng khiếu nại. Hệ thống MUST kiểm tra lại tài khoản, vai trò, cả hai quyền và trạng thái đơn tại thời điểm chấp nhận thay đổi; người gửi yêu cầu không được tự đặt người, thời điểm, trạng thái hoặc mã khiếu nại.
- **FR-011**: Đơn đã phản hồi MUST không cho thêm, sửa hoặc xóa câu trả lời trong phạm vi tính năng. Khi hai yêu cầu hợp lệ cạnh tranh cho cùng đơn chưa phản hồi, MUST chỉ chấp nhận một câu trả lời và thông báo xung đột cho yêu cầu còn lại, không ghi đè kết quả đã chấp nhận. Đọc lại MUST trả cùng câu trả lời, định danh và complaintCode.
- **FR-012**: Việc người gửi bị khóa, đổi vai trò hoặc đổi tổ chức MUST không làm mất đơn hoặc chuyển phạm vi của đơn. Tính năng MUST giữ định danh người gửi và ngữ cảnh vai trò/tổ chức gắn với lần gửi, đồng thời ghi đúng danh tính người phản hồi; không dựa vào tổ chức hiện tại của người gửi để loại đơn lịch sử.
- **FR-013**: Hệ thống MUST phân biệt chưa đăng nhập, không đủ quyền, dữ liệu nhập sai, không tìm thấy khiếu nại trong luồng, đơn đã phản hồi và sự cố xử lý bằng thông báo tiếng Việt. Định danh của luồng khác và định danh không tồn tại MUST có cùng kết quả không tìm thấy; lỗi MUST không tiết lộ thông tin nội bộ. Các trường nhập sai MUST được chỉ rõ cùng nhau mà không phản chiếu dữ liệu nhạy cảm.
- **FR-014**: Xem và phản hồi MUST không sửa định danh, complaintCode, nội dung gốc, người gửi hoặc ngữ cảnh gửi của đơn; không tạo bản sao khiếu nại. Các thao tác MUST không sửa đơn suất ăn/nguyên liệu hoặc đơn gửi cán bộ ATTP, phản hồi của các bên xử lý những đơn đó, tài khoản, tổ chức hoặc các quyền hiện có ngoài quy trình quản trị được phê duyệt.
- **FR-015**: Trước khi sử dụng tính năng với dữ liệu thật, hệ thống MUST xác định được nguồn khiếu nại gửi trực tiếp tới System Admin, trách nhiệm cấp mã khi tạo và phương án tương thích dữ liệu cũ nếu có. Không được coi các đơn suất ăn/nguyên liệu là nguồn thay thế, giả định luồng tạo đã tồn tại hoặc che thiếu mã bằng mã tạm. Tính năng quản trị này không tự mở rộng sang xây dựng thao tác gửi đơn cho mọi vai trò.

### Key Entities _(include if feature involves data)_

- **System Admin**: Người quản trị hệ thống, được phép đọc hoặc phản hồi theo quyền hiệu lực hiện tại; không có quyền bỏ qua kiểm tra phân quyền.
- **Người gửi**: Tài khoản thuộc bất kỳ vai trò nào đã gửi khiếu nại trực tiếp tới hệ thống. Danh tính, vai trò và tổ chức gắn với lần gửi là ngữ cảnh của đơn; tổ chức có thể chưa có.
- **Khiếu nại gửi tới hệ thống**: Đơn độc lập gửi tới System Admin, có định danh UUID, complaintCode, tiêu đề, mô tả, thông tin gửi, trạng thái và thời điểm cập nhật; khác với đơn suất ăn/nguyên liệu gửi các bên nghiệp vụ.
- **Mã khiếu nại complaintCode**: Mã đối chiếu bất biến dạng FP-CP-00001, phân biệt duy nhất các khiếu nại dùng cùng tiền tố và không thay thế định danh hoặc quyền truy cập.
- **Phản hồi System Admin**: Một câu trả lời chính thức gắn với đơn gửi tới hệ thống, gồm nội dung, tài khoản thực hiện và thời điểm; không thay thế phản hồi của trường hoặc nhà cung cấp trên đơn khác.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Với bộ tình huống có người gửi thuộc từng vai trò hiện hành và nhiều tổ chức, System Admin đủ quyền duyệt được 100% đơn gửi trực tiếp tới hệ thống, không trùng/bỏ sót khi dữ liệu không đổi; 0 đơn suất ăn/nguyên liệu hoặc đơn gửi cán bộ ATTP bị nhập nhầm vào danh sách.
- **SC-002**: 100% đơn trong danh sách, chi tiết và kết quả phản hồi có cùng định danh và complaintCode gốc; không có hai khiếu nại độc lập dùng chung mã FP-CP-, kể cả khi cấp mã đồng thời hoặc vượt số 99999.
- **SC-003**: 100% lần đọc hoặc phản hồi trái phép trong bộ tình huống nghiệm thu bị chặn, gồm tài khoản không phải System Admin, thiếu một quyền, bị khóa hoặc thay đổi thẩm quyền trước thời điểm chấp nhận phản hồi.
- **SC-004**: 100% phản hồi hợp lệ được chấp nhận đọc lại đúng nội dung, người, thời điểm và trạng thái; mọi tình huống hai yêu cầu hợp lệ cạnh tranh cho cùng đơn chỉ lưu một phản hồi và không ghi đè kết quả.
- **SC-005**: 100% tình huống dữ liệu sai, gửi lặp và sự cố lưu được kiểm chứng không tạo phản hồi thiếu thành phần, đổi mã, sửa nội dung gốc hoặc ảnh hưởng khiếu nại của các luồng gửi Ban Giám hiệu, nhà cung cấp hoặc cán bộ ATTP.
- **SC-006**: Khi có giao diện và luồng dữ liệu đầy đủ, ít nhất 90% System Admin tham gia nghiệm thu có đủ quyền hoàn thành việc tìm đơn được chỉ định, đọc chi tiết và gửi câu trả lời hợp lệ trong 2 phút ở lần thử đầu. Chỉ đo tiêu chí này qua thao tác người dùng thực tế, không suy ra từ kiểm chứng xử lý dữ liệu.

## Assumptions

- Theo yêu cầu ngày 2026-11-17, tính năng được giữ riêng trên nhánh `feat/system-complaint-management` và tạm dừng chờ thiết kế DB mới. Các yêu cầu nghiệp vụ đã xác nhận được bảo toàn; khi tiếp tục cần đối chiếu đặc tả với thiết kế DB mới trước khi lập kế hoạch hoặc triển khai.
- Phương án A do người dùng xác nhận quyết định phạm vi: đây là luồng khiếu nại gửi trực tiếp tới System Admin, độc lập với các luồng gửi Ban Giám hiệu, nhà cung cấp và cán bộ ATTP. "Từ tất cả vai trò" nói về nguồn người gửi; không trao quyền quản trị khiếu nại hệ thống cho mọi vai trò.
- Sáu tuyến gửi nêu trong Clarifications là yêu cầu bối cảnh do người dùng cung cấp, không có nghĩa cả sáu đã có khả năng xử lý trong hệ thống hiện tại. Luồng giáo viên/phụ huynh gửi Ban Giám hiệu có thể cùng thuộc nghiệp vụ suất ăn khi cùng đối tượng và quy trình; nguồn người gửi không tự quyết định phải tách nơi lưu trữ. Việc gom lõi dữ liệu, giữ các phần nghiệp vụ riêng và chuyển đổi dữ liệu cũ là quyết định của plan, chưa phải thay đổi đã được triển khai.
- Các đơn gửi cán bộ ATTP là phạm vi cần đặc tả riêng. Trường hợp phụ huynh gửi tiếp sau câu trả lời của Ban Giám hiệu cần chốt quan hệ với đơn gốc, mã định danh, điều kiện gửi và quyền xem bằng chứng khi thiết kế luồng đó; không mặc định chuyển đơn cũ sang System Admin hoặc tự mở rộng quyền truy cập. Trong repository, vai trò phía phụ huynh hiện được biểu diễn bằng Ban Đại diện Phụ huynh; yêu cầu này không tự bổ sung tài khoản phụ huynh cá nhân mới.
- Yêu cầu hiện tại tập trung vào ba thao tác của System Admin. Tạo/gửi khiếu nại, đọc phản hồi phía người gửi, giao diện nhập đơn và quyền gửi của từng vai trò cần đặc tả/thiết kế riêng; đây là phụ thuộc đầu vào, không phải các khả năng đã có. Khảo sát hiện tại chỉ xác nhận hai luồng suất ăn/nguyên liệu, chưa xác nhận có luồng gửi trực tiếp tới System Admin.
- Đặc tả trước về [khiếu nại nhà cung cấp](../supplier-complaint-response/spec.md) đã giữ UUID và bổ sung complaintCode. Tính năng này kế thừa cách phân biệt hai định danh và cú pháp mã; không sửa phạm vi, quyền hoặc câu trả lời của tính năng trước. Quy tắc không trùng mã giữa các luồng cùng tiền tố cần được đối chiếu khi lập kế hoạch cấp mã dùng chung.
- Vai trò/tổ chức của người gửi cần phản ánh ngữ cảnh lúc gửi để giữ lịch sử. Nếu có dữ liệu cũ không lưu ngữ cảnh này, kế hoạch phải nêu nguồn thông tin có thể xác minh và cách biểu diễn chưa có; không giả mạo tổ chức/vai trò lịch sử bằng giá trị hiện tại.
- Mặc định mỗi đơn có một phản hồi chính thức, với hai trạng thái nghiệp vụ chưa phản hồi và đã phản hồi. Trao đổi nhiều lượt, sửa/xóa phản hồi, phân công người xử lý, chuyển tiếp, đóng/mở lại và tiếp quản đơn suất ăn/nguyên liệu nằm ngoài phạm vi.
- Phân trang theo quy ước chung: mặc định trang 1, mỗi trang 20 mục, tối đa 100 mục; tham số không hợp lệ bị từ chối. Tìm kiếm, bộ lọc tùy chọn, thay thứ tự sắp xếp, xuất báo cáo, tệp đính kèm và thông báo email/tức thời chưa thuộc yêu cầu.
- Sử dụng cơ chế đăng nhập và quản trị quyền hiện hành. Mã quyền cụ thể và cách đưa quyền của luồng mới vào danh mục sẽ được xác định trong plan; không thêm quyền bằng cách bỏ qua kiểm tra hoặc tự sửa quyền System Admin qua thao tác bị cấm.
- Không xây dựng giao diện trong phạm vi đặc tả xử lý nghiệp vụ này. SC-006 là mục tiêu nghiệm thu trải nghiệm khi có đủ giao diện và nguồn đơn, chưa phải kết quả đã được đo.
