# Feature Specification: Nhà cung cấp xem và phản hồi khiếu nại nguyên liệu

**Feature Branch**: `feat/supplier-complaint-response`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "là admin và staff của nhà cung cấp tôi muốn xem được danh sách, xem chi tiết và phản hồi lại khiếu nại mà nhà trường liên kết với tôi gửi tới cho tôi"

## Clarifications

### Session 2026-11-17

- Q: Mã FP-CP-00001 được dùng làm id trong dữ liệu trả về và đường dẫn, hay là một trường mã riêng bên cạnh UUID? → A: Chọn B: giữ id UUID, thêm complaintCode dạng FP-CP-00001 và tiếp tục dùng UUID cho đường dẫn chi tiết/phản hồi. Mã được tạo một lần khi Ban Giám hiệu tạo khiếu nại; nhà cung cấp đọc lại mã của cùng khiếu nại, không sinh mã hoặc tạo bản sao riêng.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Xem danh sách khiếu nại gửi tới nhà cung cấp (Priority: P1)

Là admin hoặc staff của nhà cung cấp được cấp quyền xem, tôi muốn xem các khiếu nại chất lượng nguyên liệu mà nhà trường gửi cho đơn vị mình để nhận biết các việc cần phản hồi.

**Why this priority**: Danh sách giúp đơn vị tiếp nhận đúng khiếu nại thuộc trách nhiệm của mình và phân biệt đơn chưa phản hồi với đơn đã phản hồi.

**Independent Test**: Chuẩn bị khiếu nại thuộc nhiều trường và nhiều nhà cung cấp; đăng nhập bằng admin và staff có quyền xem để kiểm tra danh sách chỉ có các khiếu nại gửi tới nhà cung cấp hiện tại.

**Acceptance Scenarios**:

1. **Given** nhiều trường đã gửi khiếu nại cho nhà cung cấp A và B, **When** admin hoặc staff có quyền xem của A mở danh sách, **Then** chỉ nhận được khiếu nại gắn với chuyến giao hàng của A, gồm cả khiếu nại do tài khoản khác gửi và khiếu nại đã phản hồi.
2. **Given** danh sách có nhiều hơn một trang, **When** người dùng xem các trang liên tiếp khi dữ liệu không thay đổi, **Then** mỗi khiếu nại xuất hiện đúng một lần theo thứ tự mới nhất trước; các khiếu nại có cùng thời điểm gửi có thứ tự nhất quán.
3. **Given** một khiếu nại trong danh sách, **When** người dùng xem thông tin tóm tắt, **Then** thấy định danh UUID của khiếu nại, mã khiếu nại complaintCode dạng FP-CP-00001, tiêu đề, trường gửi gồm định danh/tên/mã trường, định danh/mã chuyến giao hàng, trạng thái, thời điểm gửi và thời điểm phản hồi nếu có; mã trường chưa có được để trống, không thay bằng định danh trường.
4. **Given** nhà cung cấp chưa nhận khiếu nại nào, **When** người dùng mở danh sách, **Then** nhận danh sách rỗng và thông tin phân trang hợp lệ.
5. **Given** tài khoản bị khóa hoặc quyền xem đã bị thu hồi, **When** người dùng tiếp tục xem danh sách, **Then** hệ thống từ chối truy cập dù người dùng đã đăng nhập trước đó.
6. **Given** Ban Giám hiệu đã tạo một khiếu nại với định danh UUID và mã FP-CP-00001, **When** nhà cung cấp nhận danh sách hoặc đọc lại nhiều lần, **Then** cùng khiếu nại luôn có cùng UUID và complaintCode như phía trường, không phát sinh mã mới khi đọc.

---

### User Story 2 - Xem chi tiết khiếu nại (Priority: P1)

Là admin hoặc staff có quyền xem, tôi muốn đọc nội dung khiếu nại cùng trường gửi, chuyến giao hàng, lô nguyên liệu liên quan và phản hồi hiện có để hiểu vấn đề cần xử lý.

**Why this priority**: Nội dung đầy đủ và ngữ cảnh giao hàng là cơ sở để nhà cung cấp đưa ra phản hồi đúng sự việc.

**Independent Test**: Mở trực tiếp một khiếu nại thuộc đơn vị và một khiếu nại thuộc đơn vị khác, không phụ thuộc vào thao tác mở danh sách trước đó.

**Acceptance Scenarios**:

1. **Given** khiếu nại chưa phản hồi thuộc nhà cung cấp hiện tại, **When** người có quyền xem mở chi tiết, **Then** thấy thông tin tóm tắt, toàn bộ mô tả, định danh/tên người gửi, thời điểm cập nhật và thông tin lô nguyên liệu nếu có; phần nội dung/người/thời điểm phản hồi chưa có giá trị.
2. **Given** khiếu nại đã phản hồi, **When** người dùng mở chi tiết, **Then** thấy chính xác nội dung phản hồi, định danh/tên người phản hồi, thời điểm phản hồi và trạng thái đã phản hồi.
3. **Given** khiếu nại không gắn một lô nguyên liệu cụ thể, **When** người dùng mở chi tiết, **Then** vẫn đọc được khiếu nại gắn với chuyến giao hàng và thông tin lô được để trống.
4. **Given** người dùng thử mở khiếu nại của nhà cung cấp khác hoặc một định danh không tồn tại, **When** yêu cầu được xử lý, **Then** nhận cùng thông báo không tìm thấy trong phạm vi được phép, không biết được dữ liệu của đơn vị khác có tồn tại hay không.
5. **Given** trường và nhà cung cấp đã tạm dừng hoặc ngừng liên kết sau khi phát sinh chuyến giao hàng, **When** người có quyền mở khiếu nại của chuyến giao hàng đó, **Then** vẫn đọc được nội dung và phản hồi lịch sử của chính đơn vị mình.
6. **Given** người dùng có quyền biết UUID của khiếu nại, **When** mở chi tiết bằng UUID đó, **Then** dữ liệu có cả id UUID và complaintCode giống ở danh sách/phía trường; mã FP-CP-00001 chỉ là mã đối chiếu, không thay định danh dùng để mở chi tiết.

---

### User Story 3 - Gửi phản hồi chính thức cho nhà trường (Priority: P1)

Là admin hoặc staff có quyền phản hồi và quyền xem, tôi muốn gửi nội dung trả lời cho khiếu nại chưa phản hồi để nhà trường nhận được câu trả lời chính thức của nhà cung cấp.

**Why this priority**: Phản hồi là kết quả nghiệp vụ chính của tính năng, giúp nhà trường biết hướng giải thích hoặc xử lý từ đơn vị chịu trách nhiệm giao hàng.

**Independent Test**: Chuẩn bị khiếu nại chưa phản hồi; gửi câu trả lời bằng tài khoản được phép rồi đọc lại bằng tài khoản khác cùng nhà cung cấp và kiểm tra nội dung phản hồi mà phía trường được phép đọc.

**Acceptance Scenarios**:

1. **Given** khiếu nại chưa phản hồi thuộc đơn vị và người dùng có đủ quyền, **When** gửi nội dung hợp lệ bằng định danh UUID của khiếu nại, **Then** khiếu nại chuyển từ chưa phản hồi sang đã phản hồi; lưu cùng nhau nội dung, người thực sự phản hồi và thời điểm phản hồi, đồng thời trả kết quả đã lưu cho người gửi với id và complaintCode của khiếu nại gốc được giữ nguyên.
2. **Given** nhân viên có quyền xem nhưng không có quyền phản hồi, hoặc có quyền phản hồi nhưng không có quyền xem, **When** cố gửi câu trả lời, **Then** bị từ chối và khiếu nại không thay đổi.
3. **Given** nội dung rỗng, chỉ có khoảng trắng hoặc vượt quá 5.000 ký tự sau khi bỏ khoảng trắng ở hai đầu, **When** gửi phản hồi, **Then** nhận thông báo tiếng Việt chỉ rõ trường không hợp lệ và không có thay đổi nào được lưu.
4. **Given** khiếu nại đã được phản hồi, **When** một người gửi lại hoặc hai người đồng thời gửi phản hồi cho cùng khiếu nại chưa phản hồi, **Then** chỉ một phản hồi chính thức được lưu; yêu cầu còn lại được thông báo khiếu nại đã được phản hồi và không ghi đè nội dung/người/thời điểm đã lưu.
5. **Given** quyền phản hồi, quyền xem, vai trò hoặc tư cách thành viên nhà cung cấp của người dùng không còn hợp lệ trước khi hoàn tất lưu, **When** hệ thống kiểm tra để chấp nhận phản hồi, **Then** từ chối và không lưu phản hồi dưới danh nghĩa người không còn đủ thẩm quyền.
6. **Given** khiếu nại thuộc đơn vị khác, **When** người dùng thay định danh khiếu nại hoặc cung cấp thông tin tổ chức/người phản hồi khác, **Then** không thể chuyển phạm vi truy cập hoặc mạo danh người phản hồi; dữ liệu hai đơn vị đều không bị sửa trái phép.
7. **Given** trường đã ngừng liên kết nhưng khiếu nại của chuyến giao hàng thuộc nhà cung cấp vẫn chưa phản hồi, **When** người có đủ quyền gửi câu trả lời, **Then** phản hồi vẫn được chấp nhận để giải quyết trách nhiệm của giao dịch trước đó.

### Edge Cases

- Nhiều trường cùng gửi khiếu nại cho một nhà cung cấp; một trường gửi khiếu nại cho nhiều nhà cung cấp: phân tách theo bên thực hiện chuyến giao hàng, không chỉ theo trường hoặc quan hệ liên kết.
- Trường vẫn liên kết với nhà cung cấp nhưng khiếu nại thuộc chuyến giao của nhà cung cấp khác: không cho xem hoặc phản hồi.
- Nhiều đợt liên kết với cùng trường, quan hệ tạm dừng/ngừng liên kết, trường không còn hoạt động hoặc hợp đồng đã hết hạn: giữ khả năng xử lý khiếu nại lịch sử thuộc nhà cung cấp.
- Mã trường chưa được khai báo hoặc trùng giữa các trường: giữ định danh trường riêng; mã chỉ dùng để hiển thị, không quyết định quyền truy cập.
- Mã khiếu nại complaintCode là mã đối chiếu do luồng tạo khiếu nại phía Ban Giám hiệu cung cấp; nhà cung cấp không được tự gửi, sửa hoặc sinh mã khi đọc/phản hồi. Biết mã không thay thế kiểm tra quyền và phạm vi tổ chức.
- Dữ liệu khiếu nại cũ chưa có complaintCode cần được xử lý trong kế hoạch tương thích dữ liệu với luồng tạo đơn; nhà cung cấp không được tự bịa mã từ UUID hoặc cấp số mới lúc đọc để che thiếu dữ liệu.
- Người gửi hoặc người từng phản hồi bị khóa/chuyển tổ chức: vẫn giữ liên hệ với tài khoản đã ghi nhận; không dựa vào tổ chức hiện tại của họ để chuyển chủ sở hữu khiếu nại.
- Phản hồi có tiếng Việt, xuống dòng hoặc ký tự giống định dạng nội dung: giữ nội dung văn bản sau chuẩn hóa khoảng trắng ở hai đầu, không tự diễn giải thành nội dung thực thi.
- Nội dung đúng 5.000 ký tự được chấp nhận; 5.001 ký tự bị từ chối. Chỉ nhận nội dung phản hồi, không nhận trạng thái, người phản hồi hoặc thời điểm do người gửi tự đặt.
- Phân trang hoặc định danh không hợp lệ: thông báo lỗi nhập liệu bằng tiếng Việt; trang vượt cuối trả danh sách rỗng.
- Sự cố khi đọc hoặc lưu: báo không thể hoàn tất; không trả thông tin nội bộ và không để lại trạng thái đã phản hồi thiếu nội dung/người/thời điểm. Nếu không nhận được xác nhận do mất kết nối sau khi lưu, người dùng có thể đọc lại kết quả trước khi thử gửi lại.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cho phép tài khoản admin và staff đang hoạt động của nhà cung cấp sử dụng tính năng theo quyền hiệu lực hiện tại; vai trò nhà cung cấp không tự động thay thế kiểm tra quyền.
- **FR-002**: Việc xem danh sách và chi tiết MUST yêu cầu quyền xem chi tiết phản hồi chất lượng nguyên liệu; việc gửi phản hồi MUST đồng thời yêu cầu quyền xem đó và quyền trả lời phản hồi chất lượng nguyên liệu. Quyền bị thu hồi theo tài khoản MUST được áp dụng.
- **FR-003**: Hệ thống MUST chỉ cho nhà cung cấp truy cập khiếu nại gắn với chuyến giao hàng do chính đơn vị đó cung cấp. Phạm vi MUST được xác định từ tài khoản đăng nhập; việc biết định danh trường/khiếu nại hoặc đang liên kết với trường không đủ để truy cập dữ liệu của nhà cung cấp khác.
- **FR-004**: Hệ thống MUST giữ quyền đọc và phản hồi khiếu nại chưa phản hồi của giao dịch thuộc nhà cung cấp khi quan hệ trường–nhà cung cấp tạm dừng/ngừng liên kết, trường không còn hoạt động hoặc hợp đồng hết hạn; không dùng trạng thái hiện tại của các đối tượng đó để chuyển trách nhiệm sang đơn vị khác.
- **FR-005**: Danh sách MUST gồm các khiếu nại chưa phản hồi và đã phản hồi thuộc phạm vi, không giới hạn ở người đang đăng nhập; hỗ trợ phân trang và sắp xếp thời điểm gửi giảm dần với thứ tự phụ ổn định theo định danh khi trùng thời điểm. Khi dữ liệu không đổi, không trùng hoặc mất mục giữa các trang.
- **FR-006**: Mỗi mục danh sách MUST cung cấp id UUID và complaintCode của khiếu nại, tiêu đề, định danh/tên/mã trường, định danh/mã chuyến giao hàng, trạng thái, thời điểm gửi và thời điểm phản hồi nếu có. Mã trường chưa khai báo MUST để trống; không thay bằng định danh trường. Danh sách rỗng/trang vượt cuối MUST là kết quả hợp lệ.
- **FR-007**: Chi tiết MUST bổ sung toàn bộ mô tả, định danh/tên người gửi, thời điểm cập nhật, định danh/mã lô nguyên liệu nếu có, nội dung phản hồi và định danh/tên/thời điểm người phản hồi nếu có; dữ liệu chưa có MUST được biểu diễn là chưa có, không tự tạo giá trị thay thế.
- **FR-008**: Hệ thống MUST cho phép gửi một phản hồi văn bản chính thức cho khiếu nại ở trạng thái chưa phản hồi (`SUBMITTED`), chuyển sang đã phản hồi (`RESPONDED`) khi thành công. Nội dung sau khi bỏ khoảng trắng ở hai đầu MUST có từ 1 đến 5.000 ký tự, giữ nguyên xuống dòng bên trong và không rỗng.
- **FR-009**: Nội dung, tài khoản thực sự phản hồi, thời điểm phản hồi và trạng thái mới MUST được ghi nhận cùng nhau; định danh/tư cách/quyền người thực hiện và phạm vi khiếu nại MUST được kiểm tra lại khi quyết định chấp nhận thay đổi. Người dùng không được tự đặt người, thời điểm hoặc trạng thái phản hồi.
- **FR-010**: Khiếu nại đã phản hồi MUST không cho gửi thêm, sửa hoặc xóa câu trả lời trong phạm vi tính năng này. Với các phản hồi cạnh tranh cho cùng một khiếu nại, MUST chỉ chấp nhận một phản hồi và báo rõ xung đột cho yêu cầu còn lại mà không ghi đè kết quả đã chấp nhận.
- **FR-011**: Phản hồi đã lưu MUST xuất hiện nhất quán khi đọc lại chi tiết bởi tài khoản được phép trong nhà cung cấp và trong thông tin phản hồi mà nhà trường sở hữu khiếu nại được phép đọc. Việc lưu MUST không tạo một khiếu nại độc lập khác.
- **FR-012**: Hệ thống MUST phân biệt lỗi chưa đăng nhập, không đủ quyền, dữ liệu nhập không hợp lệ, khiếu nại không tìm thấy trong phạm vi, khiếu nại đã phản hồi và sự cố xử lý; thông báo tiếng Việt. Khiếu nại ngoài phạm vi và không tồn tại MUST có cùng thông báo, không tiết lộ sự tồn tại của dữ liệu đơn vị khác.
- **FR-013**: Hệ thống MUST chỉ cung cấp các thông tin nghiệp vụ được liệt kê trong FR-006/FR-007 và phản hồi vừa lưu; không tiết lộ thông tin đăng nhập, quyền nội bộ, liên hệ cá nhân không cần thiết hoặc dữ liệu tổ chức khác. Khi nhập nhiều trường sai, MUST chỉ rõ các trường vi phạm mà không phản chiếu nội dung nhạy cảm.
- **FR-014**: Việc xem hoặc gửi phản hồi MUST không sửa id/complaintCode, nội dung/người gửi khiếu nại, chuyến giao hàng, lô nguyên liệu, hợp đồng, quan hệ liên kết hoặc trạng thái hoạt động của tài khoản. Tính năng MUST giữ hành vi đọc của các nhóm người dùng hiện có ngoài phạm vi nhà cung cấp và không cấp thêm quyền ngoài quy trình quản trị quyền hiện hành.
- **FR-015**: Khiếu nại MUST có mã nghiệp vụ complaintCode dạng FP-CP-00001, được cấp một lần và lưu khi Ban Giám hiệu tạo khiếu nại. Mỗi mã MUST nhận diện duy nhất một khiếu nại trong hệ thống và giữ nguyên giữa phía trường và nhà cung cấp. Danh sách, chi tiết và kết quả phản hồi MUST trả cùng mã đã lưu của khiếu nại gốc, bên cạnh id UUID; đường dẫn chi tiết/phản hồi MUST tiếp tục dùng UUID. Nhà cung cấp MUST không cấp lại số, suy ra mã từ UUID, sửa mã hoặc tạo bản sao khiếu nại riêng; nội dung gửi phản hồi không chấp nhận complaintCode do người dùng đặt.

### Key Entities _(include if feature involves data)_

- **Nhà cung cấp**: Đơn vị nhận khiếu nại, được xác định theo bên cung cấp chuyến giao hàng liên quan.
- **Tài khoản nhà cung cấp**: Admin hoặc staff đang thuộc một nhà cung cấp; quyền xem và quyền phản hồi được đánh giá theo thiết lập hiện hành.
- **Nhà trường**: Đơn vị nhận chuyến giao hàng và sở hữu khiếu nại; có định danh riêng, tên và mã trường có thể chưa khai báo.
- **Chuyến giao hàng**: Xác định nhà cung cấp chịu trách nhiệm và nhà trường nhận hàng; có định danh và mã chuyến để đối chiếu khiếu nại.
- **Lô nguyên liệu**: Đối tượng liên quan tùy chọn của khiếu nại; không phải mọi khiếu nại đều chỉ định một lô.
- **Khiếu nại chất lượng nguyên liệu**: Gồm định danh UUID, mã complaintCode duy nhất dạng FP-CP-00001 được cấp từ lúc Ban Giám hiệu tạo đơn, chuyến giao hàng, lô tùy chọn, người gửi, tiêu đề, mô tả, trạng thái và thời điểm gửi/cập nhật. UUID định vị bản ghi; complaintCode dùng để đối chiếu cùng khiếu nại giữa các bên, không phải mã trường.
- **Phản hồi nhà cung cấp**: Một câu trả lời chính thức thuộc khiếu nại, gồm nội dung, tài khoản phản hồi và thời điểm phản hồi; được chia sẻ trong phạm vi người có quyền đọc khiếu nại đó.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Trong toàn bộ tình huống kiểm chứng phân quyền và cô lập tổ chức, 100% lần đọc hoặc phản hồi trái phép bị chặn, không làm lộ khiếu nại của đơn vị khác.
- **SC-002**: Khi dữ liệu không thay đổi, người dùng có thể duyệt hết 100% khiếu nại thuộc nhà cung cấp qua các trang, không trùng hoặc bỏ sót; id UUID, complaintCode, dữ liệu trường/chuyến giao và trạng thái khớp từng khiếu nại gốc do Ban Giám hiệu tạo.
- **SC-003**: 100% phản hồi hợp lệ được chấp nhận đều có đúng nội dung, người và thời điểm khi đọc lại; nhà trường có quyền đọc nhận được cùng nội dung phản hồi trên cùng id UUID và complaintCode, không thay mã hoặc tạo bản sao khiếu nại.
- **SC-004**: Trong mọi tình huống gửi đồng thời cho cùng một khiếu nại chưa phản hồi, đúng một phản hồi được chấp nhận; 100% yêu cầu cạnh tranh hoặc gửi lại không ghi đè kết quả đó.
- **SC-005**: 100% tình huống nhập liệu sai, thiếu quyền và sự cố lưu được kiểm chứng không tạo phản hồi thiếu thành phần hoặc sửa dữ liệu nghiệp vụ ngoài khiếu nại được phép xử lý.
- **SC-006**: Trong nghiệm thu luồng sử dụng đầy đủ, ít nhất 90% người tham gia có đủ quyền có thể tìm khiếu nại được chỉ định, đọc chi tiết và gửi một câu trả lời mẫu hợp lệ trong 2 phút ở lần thử đầu tiên. Tiêu chí này cần được đo khi có giao diện sử dụng đầy đủ; không suy ra từ việc kiểm tra xử lý dữ liệu đơn thuần.

## Assumptions

- "Khiếu nại nhà trường gửi tới nhà cung cấp" được hiểu là phản hồi chất lượng nguyên liệu gắn với chuyến giao hàng/lô nguyên liệu trong nghiệp vụ hiện có; không phải khiếu nại suất ăn mà giáo viên hoặc đại diện phụ huynh gửi Ban Giám hiệu.
- Ban Giám hiệu tạo khiếu nại chất lượng nguyên liệu và luồng tạo đó chịu trách nhiệm cấp/lưu complaintCode dùng chung. Luồng tạo thuộc phần việc phía trường, không phải thao tác của nhà cung cấp; tính năng này không mở rộng sang khiếu nại suất ăn gửi Ban Giám hiệu. Luồng đọc của trường giữ nguyên phạm vi và thể hiện phản hồi đã lưu khi trường có quyền đọc.
- Nguồn mã complaintCode và phương án tương thích cho dữ liệu cũ là phụ thuộc cần được thiết kế khi cập nhật plan/data-model/contract/tasks; không được giả định mã đã tồn tại trong dữ liệu hiện hành hoặc tự sinh mã trong thao tác GET của nhà cung cấp. Quy tắc cấp số, lưu trữ và chuyển đổi dữ liệu thuộc bước thiết kế luồng tạo/dữ liệu dùng chung.
- Cụm "nhà trường liên kết với tôi" diễn tả quan hệ phát sinh giao dịch. Trách nhiệm với khiếu nại được giữ theo chuyến giao hàng, kể cả khi quan hệ hiện tại đã tạm dừng/ngừng liên kết; không yêu cầu còn hợp đồng hiệu lực để xử lý khiếu nại cũ.
- Mỗi khiếu nại có một phản hồi chính thức, phù hợp hai trạng thái hiện có; trao đổi nhiều lượt, sửa/xóa phản hồi, chuyển người xử lý và quy trình đóng/mở lại khiếu nại nằm ngoài phạm vi.
- Giới hạn 5.000 ký tự cho câu trả lời và việc bỏ khoảng trắng ở hai đầu là mặc định được chọn để giới hạn nhập liệu; nội dung chỉ là văn bản. Không bổ sung tệp/ảnh đính kèm, hoàn tiền, đổi trả, thông báo email/tức thời hoặc báo cáo xuất file.
- Phân trang dùng quy ước chung hiện hành: mặc định trang 1, mỗi trang 20 mục, tối đa 100 mục; tham số không hợp lệ bị từ chối. Tìm kiếm, lọc nâng cao và chọn thứ tự sắp xếp nằm ngoài phạm vi.
- Dùng cơ chế đăng nhập, quản trị quyền và dữ liệu giao hàng/khiếu nại hiện có. Không tự tạo tài khoản, cấp thêm quyền cho vai trò/tài khoản đã tồn tại hoặc thay đổi nghiệp vụ khiếu nại suất ăn.
- Đặc tả tập trung khả năng xử lý nghiệp vụ của hệ thống; không bao gồm xây dựng giao diện. SC-006 là mục tiêu nghiệm thu trải nghiệm khi có luồng sử dụng đầy đủ.
