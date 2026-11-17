# Feature Specification: Nhà cung cấp xem trường đã liên kết và hợp đồng

**Feature Branch**: `feat/supplier-linked-schools`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Là admin của nhà cung cấp, tôi muốn xem được danh sách nhà trường mà tôi đã liên kết, xem chi tiết nhà trường mà tôi đã liên kết (trong đó có xem được hợp đồng mà nhà trường đã tải lên hệ thống)."

## Clarifications

### Session 2026-11-17

- Q: Danh sách và các thao tác mở chi tiết/hợp đồng dùng mã trường thay UUID hay giữ UUID? → A: Giữ UUID; dữ liệu danh sách trả thêm mã trường cùng UUID. Mã trường phục vụ hiển thị, còn truy cập chi tiết trường và hợp đồng tiếp tục dùng UUID.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Xem danh sách trường đã liên kết (Priority: P1)

Là quản trị viên nhà cung cấp, tôi muốn xem các trường đã có quan hệ liên kết với nhà cung cấp của mình, để nhận biết trường đang hợp tác và tra cứu trường từng hợp tác.

**Why this priority**: Đây là điểm bắt đầu để quản trị viên tìm đúng trường và mở thông tin hợp tác của mình.

**Independent Test**: Chuẩn bị hai nhà cung cấp có tập trường liên kết riêng, có một trường liên kết với cả hai và một trường chưa liên kết; đăng nhập từng quản trị viên và kiểm tra danh sách chỉ chứa trường có quan hệ với nhà cung cấp tương ứng.

**Acceptance Scenarios**:

1. **Given** quản trị viên có quyền truy cập và nhà cung cấp đã liên kết với nhiều trường, **When** xem danh sách, **Then** mỗi trường xuất hiện một lần với định danh UUID, mã trường, tên, địa chỉ, thông tin liên hệ, trạng thái trường và trạng thái liên kết đại diện; mã trường được trả cùng UUID để hiển thị, không thay thế UUID.
2. **Given** có quan hệ đang liên kết, tạm ngưng và đã hủy liên kết, **When** xem danh sách mặc định, **Then** danh sách bao gồm cả ba nhóm và phân biệt rõ trạng thái liên kết với trạng thái hoạt động của trường.
3. **Given** một trường từng hủy rồi liên kết lại nhiều lần, **When** xem danh sách, **Then** trường chỉ xuất hiện một lần; quan hệ đang liên kết hoặc tạm ngưng được dùng làm đại diện, nếu không có thì dùng quan hệ đã hủy gần nhất.
4. **Given** có nhiều trường hơn kích thước một trang, **When** chuyển trang trên tập dữ liệu không đổi, **Then** có thể xem hết các trường, không lặp hoặc bỏ sót trường và biết còn trang tiếp theo hay không.
5. **Given** nhà cung cấp chưa có trường liên kết, **When** xem danh sách, **Then** nhận danh sách rỗng hợp lệ.

---

### User Story 2 - Xem chi tiết trường và quan hệ hợp tác (Priority: P1)

Là quản trị viên nhà cung cấp, tôi muốn mở một trường đã liên kết để xem hồ sơ trường và quan hệ hợp tác với nhà cung cấp của mình, nhằm có thông tin liên hệ và bối cảnh hợp tác chính xác.

**Why this priority**: Danh sách cần dẫn đến đủ thông tin để quản trị viên nhận diện, liên hệ và đối chiếu hợp tác với trường.

**Independent Test**: Mở trực tiếp một trường có liên kết với nhà cung cấp đang đăng nhập, kiểm tra các thông tin được phép; thử cùng thao tác với trường chỉ liên kết với nhà cung cấp khác và với trường không tồn tại.

**Acceptance Scenarios**:

1. **Given** trường có quan hệ với nhà cung cấp của quản trị viên, **When** xem chi tiết, **Then** xem được hồ sơ trường và quan hệ đại diện của đúng cặp trường–nhà cung cấp đó.
2. **Given** liên kết đã tạm ngưng hoặc đã hủy, hoặc trường đã ngừng hoạt động, **When** xem chi tiết với quyền hợp lệ, **Then** vẫn tra cứu được và thấy đúng trạng thái hiện tại; việc tra cứu không khôi phục liên kết hay cho phép đặt hàng.
3. **Given** trường chỉ liên kết với nhà cung cấp khác hoặc không tồn tại, **When** truy cập trực tiếp chi tiết, **Then** đều nhận thông báo không tìm thấy trong phạm vi được phép, không làm lộ hồ sơ hoặc quan hệ của bên khác.
4. **Given** quản trị viên bị khóa, mất vai trò quản trị viên nhà cung cấp hoặc mất quyền truy cập sau lần xem trước, **When** tiếp tục xem chi tiết, **Then** quyền truy cập được xét lại và yêu cầu bị từ chối.

---

### User Story 3 - Xem hợp đồng và tệp hợp đồng trường đã tải lên (Priority: P1)

Là quản trị viên nhà cung cấp, tôi muốn xem hợp đồng giữa nhà cung cấp của mình và trường, đồng thời mở hoặc tải về bản hợp đồng trường đã tải lên, để đối chiếu nội dung hợp tác mà không yêu cầu trường gửi lại hồ sơ.

**Why this priority**: Tệp hợp đồng là một phần trực tiếp của yêu cầu và giúp nhà cung cấp tra cứu căn cứ hợp tác đã được trường ghi nhận.

**Independent Test**: Chuẩn bị một trường có hợp đồng với hai nhà cung cấp, gồm hợp đồng đã kích hoạt, hợp đồng đã đóng, bản nháp và tệp hợp đồng tương ứng; kiểm tra từng quản trị viên chỉ đọc được hợp đồng đã kích hoạt hoặc đã đóng cùng tệp thuộc đúng cặp của mình.

**Acceptance Scenarios**:

1. **Given** trường có hợp đồng đã kích hoạt hoặc đã đóng với nhà cung cấp đang đăng nhập, **When** xem phần hợp đồng của trường, **Then** thấy số hợp đồng, trạng thái, ngày ký, thời hạn, phạm vi cung cấp, danh mục nguyên liệu và thông tin tệp hợp đồng đã ký cùng phụ lục nếu có.
2. **Given** hợp đồng đã kích hoạt nhưng chưa đến ngày bắt đầu hoặc đã quá ngày kết thúc, **When** tra cứu, **Then** vẫn xem được; ngày hiệu lực không tự thay đổi trạng thái hợp đồng đã ghi nhận hoặc quyết định quyền đọc.
3. **Given** có tệp hợp đồng đã ký hoặc phụ lục hợp lệ, **When** chọn mở hoặc tải về, **Then** nhận đúng nội dung tệp trường đã tải lên, giữ nguyên tên tệp và loại nội dung đã lưu.
4. **Given** trường có hợp đồng với nhiều nhà cung cấp hoặc nhiều đợt liên kết với cùng nhà cung cấp, **When** tra cứu, **Then** chỉ thấy hợp đồng đã kích hoạt hoặc đã đóng của đúng cặp trường–nhà cung cấp, bao gồm các đợt liên kết trước.
5. **Given** tồn tại bản nháp của trường, **When** nhà cung cấp xem danh sách, chi tiết hợp đồng hoặc truy cập trực tiếp tệp của bản nháp, **Then** bản nháp và tệp của nó không được cung cấp.
6. **Given** trường đã có liên kết nhưng chưa có hợp đồng được phép xem hoặc hợp đồng không có tệp, **When** tra cứu, **Then** hiển thị rõ chưa có hợp đồng hoặc chưa có tệp; chi tiết trường vẫn xem được.
7. **Given** một mã hợp đồng hoặc mã tệp thuộc nhà cung cấp khác, trường khác với trường đang xem hoặc không tồn tại, **When** truy cập trực tiếp, **Then** nhận cùng thông báo không tìm thấy trong phạm vi được phép và không nhận nội dung hay thông tin nhận diện tài liệu.

### Edge Cases

- Một trường liên kết đồng thời với nhiều nhà cung cấp: mỗi nhà cung cấp chỉ thấy quan hệ và hợp đồng của mình.
- Một cặp có nhiều quan hệ đã hủy, rồi liên kết lại: danh sách trường không bị nhân bản; hợp đồng lịch sử của cặp vẫn tra cứu được.
- Hai quan hệ có cùng thời điểm liên kết: phải có quy tắc chọn đại diện và thứ tự phụ cố định để kết quả không thay đổi ngẫu nhiên.
- Trường thiếu mã, địa chỉ, email, số điện thoại, ảnh hoặc mô tả: vẫn xem được, trường dữ liệu thiếu không được tự suy diễn.
- Trạng thái trường, trạng thái liên kết và trạng thái hợp đồng khác nhau: hiển thị độc lập, không suy diễn rằng còn hợp đồng thì liên kết đang hoạt động.
- Hợp đồng đã kích hoạt có ngày bắt đầu ở tương lai hoặc đã hết thời hạn: vẫn đọc được như hồ sơ hợp tác.
- Hợp đồng có nhiều bản hợp đồng đã ký hoặc phụ lục: từng tệp được liệt kê và mở riêng, không chọn tùy ý một tệp rồi bỏ các tệp còn lại.
- Tệp đã mất hoặc không đọc được: báo lỗi phù hợp; không trả tệp rỗng như thành công, không làm mất khả năng xem thông tin trường và hợp đồng.
- Người dùng đã xem danh sách nhưng quyền hoặc tổ chức của tài khoản vừa thay đổi: lần đọc tiếp theo phải dùng quyền và tổ chức hiện tại.
- Phân trang vượt dữ liệu trả danh sách rỗng; số trang, kích thước trang hoặc định danh không hợp lệ bị từ chối với thông báo tiếng Việt dễ hiểu.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Tính năng MUST yêu cầu tài khoản đang hoạt động, thuộc vai trò quản trị viên nhà cung cấp, gắn với một nhà cung cấp xác định và có ít nhất một quyền xem hoặc quản lý liên kết nhà cung cấp đang có hiệu lực. Nhân viên nhà cung cấp và các vai trò khác không được truy cập tính năng này chỉ nhờ có quyền liên kết; quyền hiện có của các chức năng khác giữ nguyên.
- **FR-002**: Mọi lần đọc danh sách, chi tiết trường, hợp đồng và tệp MUST giới hạn theo nhà cung cấp của tài khoản đang đăng nhập và kiểm tra quyền hiện tại. Người dùng không được chọn hoặc thay thế nhà cung cấp dùng để xác định phạm vi truy cập.
- **FR-003**: Danh sách MUST chỉ gồm trường có ít nhất một quan hệ liên kết đã được ghi nhận với nhà cung cấp hiện tại, mặc định bao gồm đang liên kết, tạm ngưng và đã hủy liên kết; mỗi trường xuất hiện một lần. Trường chỉ có hợp đồng nháp mà chưa từng có quan hệ liên kết không được đưa vào danh sách.
- **FR-004**: Quan hệ đại diện của trường MUST ưu tiên quan hệ đang liên kết hoặc tạm ngưng. Khi không có quan hệ thuộc hai trạng thái này, chọn quan hệ đã hủy có thời điểm liên kết mới nhất; nếu trùng thời điểm, dùng định danh quan hệ tăng dần làm thứ tự phụ. Danh sách MUST sắp theo thời điểm liên kết của quan hệ đại diện mới nhất trước, rồi định danh trường tăng dần khi trùng thời điểm.
- **FR-005**: Danh sách trường MUST hỗ trợ phân trang, mặc định trang đầu với 20 trường, tối đa 100 trường mỗi trang, kèm thông tin trang hiện tại, kích thước trang và còn trang tiếp theo. Số trang và kích thước trang phải là số nguyên dương trong giới hạn hỗ trợ; giá trị không hợp lệ bị từ chối.
- **FR-006**: Mỗi mục danh sách MUST trả cả định danh UUID và mã trường dưới dạng hai thông tin riêng biệt, cùng tên, địa chỉ, email, số điện thoại, trạng thái hoạt động của trường, trạng thái liên kết đại diện và thời điểm liên kết tương ứng. Mã trường dùng để hiển thị; UUID tiếp tục được dùng để truy cập chi tiết trường và các hợp đồng của trường. Nếu chưa có mã trường thì trả giá trị chưa có, không thay mã trường bằng UUID hoặc dữ liệu tự sinh; các thông tin thiếu khác cũng không được lấy thay từ tài khoản cá nhân.
- **FR-007**: Chi tiết trường MUST bao gồm thông tin tại FR-006; mô tả, website, logo, ảnh bìa và quy mô bán trú nếu đã có; cùng thời điểm tạm ngưng/hủy và lý do tương ứng của quan hệ đại diện nếu có. Tính năng không cho phép sửa hồ sơ trường hoặc quan hệ liên kết.
- **FR-008**: Chi tiết trường MUST cung cấp khả năng tra cứu tất cả hợp đồng đã kích hoạt hoặc đã đóng của đúng cặp trường–nhà cung cấp, bao gồm các đợt liên kết trước; không phụ thuộc thời hạn hợp đồng, trạng thái liên kết hoặc trạng thái hoạt động của trường. Hợp đồng nháp và tài liệu của bản nháp MUST không được cung cấp qua tính năng này.
- **FR-009**: Danh sách hợp đồng MUST phân trang độc lập với danh sách trường, mặc định 20 và tối đa 100 hợp đồng mỗi trang, có thông tin trang hiện tại, kích thước trang và trang tiếp theo; sắp thời điểm tạo mới nhất trước, dùng định danh hợp đồng tăng dần khi trùng thời điểm. Quy tắc kiểm tra số trang và kích thước trang như FR-005.
- **FR-010**: Mỗi hợp đồng được phép xem MUST cung cấp định danh, số hợp đồng, trạng thái, ngày ký, ngày bắt đầu/kết thúc, ghi chú phạm vi, danh mục nguyên liệu thuộc hợp đồng, thời điểm kích hoạt và thời điểm/lý do đóng nếu có. Không gộp trạng thái đã kích hoạt với kết luận hợp đồng đang trong thời hạn hoặc đang đủ điều kiện đặt hàng.
- **FR-011**: Với mỗi hợp đồng được phép xem, hệ thống MUST liệt kê các tệp bản hợp đồng đã ký và phụ lục do trường tải lên, gồm định danh tệp, loại tài liệu, tên tệp, loại nội dung, kích thước và thời điểm tải lên. Người dùng MUST có thể mở hoặc tải về từng tệp, nhận đúng nội dung gốc; tài liệu minh chứng an toàn thực phẩm không thuộc phạm vi đọc tệp của tính năng này.
- **FR-012**: Khi đọc hợp đồng hoặc tệp, hệ thống MUST kiểm tra đồng thời trường đang tra cứu, nhà cung cấp hiện tại, quan hệ liên kết của cặp, trạng thái hợp đồng được phép xem và việc tệp thực sự thuộc hợp đồng đó. Biết định danh tài nguyên không làm phát sinh quyền truy cập.
- **FR-013**: Tài nguyên không tồn tại hoặc nằm ngoài phạm vi được phép MUST có cùng kết quả không tìm thấy; lỗi quyền truy cập không được làm lộ thông tin trường, hợp đồng, tên tệp hay nội dung tài liệu của bên khác. Thông báo lỗi đầu vào và lỗi đọc tài liệu phải bằng tiếng Việt, không chứa thông tin nội bộ hoặc dữ liệu nhạy cảm.
- **FR-014**: Đầu ra MUST chỉ chứa các thông tin được liệt kê ở FR-006, FR-007, FR-010 và FR-011 cùng thông tin phân trang cần thiết. Không cung cấp tài khoản nhân sự, thông tin học sinh, hồ sơ đăng ký nội bộ, bí mật đăng nhập hoặc hợp đồng với nhà cung cấp khác.
- **FR-015**: Mọi thao tác của tính năng MUST chỉ đọc dữ liệu hiện có. Không tạo/thay đổi liên kết, hợp đồng hoặc tệp; không kích hoạt/đóng hợp đồng; không thay đổi quy tắc đặt hàng, tải hồ sơ và quản lý hợp đồng phía trường.
- **FR-016**: Các trường hợp chưa có trường liên kết, chưa có hợp đồng hoặc chưa có tệp MUST có kết quả rỗng hợp lệ, phân biệt được với lỗi truy cập và lỗi đọc dữ liệu. Tệp không đọc được phải báo thất bại riêng mà không chặn việc xem hồ sơ trường và thông tin hợp đồng.

### Key Entities _(include if feature involves data)_

- **Nhà cung cấp**: Đơn vị của quản trị viên đang đăng nhập; là căn cứ xác định phạm vi các trường, hợp đồng và tệp được xem.
- **Trường học**: Đối tác đã có quan hệ liên kết; có định danh UUID và mã trường là hai thông tin riêng biệt. Danh sách trả cả hai; mã trường phục vụ hiển thị và có thể chưa có, UUID dùng để truy cập chi tiết/hợp đồng. Hồ sơ, liên hệ và trạng thái hoạt động lấy từ thông tin hiện có.
- **Quan hệ trường–nhà cung cấp**: Ghi nhận một đợt liên kết, gồm trạng thái đang liên kết, tạm ngưng hoặc đã hủy, các mốc thời gian và lý do. Một cặp có thể có nhiều đợt lịch sử nhưng chỉ có tối đa một quan hệ đang liên kết hoặc tạm ngưng.
- **Hợp đồng cung cấp**: Hồ sơ của một cặp trường–nhà cung cấp, có số hợp đồng, thời hạn, phạm vi, nguyên liệu, trạng thái nháp/đã kích hoạt/đã đóng và đợt liên kết tương ứng khi có. Nhà cung cấp chỉ xem các hợp đồng đã kích hoạt hoặc đã đóng.
- **Tệp hợp đồng**: Tài liệu trường đã tải lên gắn với một hợp đồng, có loại tài liệu, thông tin tệp và nội dung gốc; phạm vi tính năng gồm bản hợp đồng đã ký và phụ lục.
- **Quản trị viên nhà cung cấp**: Người dùng có tài khoản, vai trò, tổ chức và quyền hiện tại đáp ứng điều kiện truy cập tại FR-001.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Trong các tình huống nghiệm thu gồm hai nhà cung cấp, trường dùng chung, trường chưa liên kết và trường có nhiều đợt liên kết, 100% danh sách chỉ chứa đúng trường thuộc phạm vi và mỗi trường xuất hiện đúng một lần.
- **SC-002**: 100% tình huống nghiệm thu trạng thái đang liên kết/tạm ngưng/đã hủy, trường ngừng hoạt động và hợp đồng tương lai/hết thời hạn hiển thị đúng các trạng thái độc lập; hợp đồng nháp không xuất hiện và không mở được tệp.
- **SC-003**: 100% lần thử truy cập chéo nhà cung cấp, tráo trường/hợp đồng/tệp hoặc dùng tài khoản thiếu điều kiện bị từ chối mà không tiết lộ dữ liệu ngoài phạm vi.
- **SC-004**: 100% tệp hợp đồng đã ký và phụ lục được phép đọc trong bộ nghiệm thu mở hoặc tải về được với nội dung trùng khớp tệp trường đã tải lên; trường hợp mất tệp báo lỗi rõ ràng và vẫn xem được hồ sơ trường.
- **SC-005**: Khi dữ liệu không đổi, duyệt hết các trang trường và hợp đồng trong bộ nghiệm thu thu được đầy đủ tập kết quả được phép, không lặp và không bỏ sót.
- **SC-006**: Ít nhất 90% quản trị viên tham gia nghiệm thu có thể tìm một trường xác định và mở đúng tệp hợp đồng của trường đó trong tối đa 1 phút, không cần trường gửi lại tệp; đo ở bước nghiệm thu luồng sử dụng hoàn chỉnh.

## Assumptions

- “Đã liên kết” được hiểu bao gồm quan hệ hiện tại và quan hệ đã hủy để tra cứu lịch sử. Tạm ngưng/hủy liên kết không tự thu hồi quyền đọc hồ sơ hợp tác đã có của đúng cặp; không mở quyền xem hợp đồng của bên khác.
- Danh sách lấy trường làm đơn vị hiển thị. Thông tin quan hệ đại diện phục vụ nhận biết trạng thái gần nhất; xem toàn bộ nhật ký thay đổi quan hệ không thuộc phạm vi này.
- Hồ sơ nháp là dữ liệu làm việc phía trường. Việc chia sẻ cho nhà cung cấp bắt đầu khi hợp đồng được kích hoạt; các hợp đồng đã đóng vẫn được tra cứu. Không yêu cầu thêm bước công bố hoặc phê duyệt hợp đồng từ nhà cung cấp.
- “Xem hợp đồng đã tải lên” bao gồm tra cứu thông tin hợp đồng và mở/tải bản hợp đồng đã ký cùng phụ lục có sẵn. Không yêu cầu dựng trình biên tập, ký điện tử, chuyển đổi định dạng hay xem minh chứng an toàn thực phẩm trong tính năng này.
- Dùng cơ chế tài khoản, quyền liên kết, hồ sơ trường, quan hệ, hợp đồng và tệp hiện có; không thu thập thêm dữ liệu trường hoặc yêu cầu trường tải lại tài liệu.
- Phạm vi người dùng mới chỉ gồm quản trị viên nhà cung cấp theo yêu cầu. Việc mở rộng cho nhân viên nhà cung cấp hoặc sửa quyền đọc hiện có của vai trò khác cần yêu cầu riêng.
- Bộ nghiệm thu phải có liên kết lịch sử không có tệp, hợp đồng đã kích hoạt/đã đóng, hợp đồng nháp và các trường dữ liệu tùy chọn bị thiếu, nhằm kiểm tra khả năng tương thích với dữ liệu hiện có.
- Các thay đổi giới hạn ở khả năng tra cứu. Tìm kiếm nâng cao, xuất báo cáo, gửi thông báo, thống kê hợp tác và tạo/sửa/hủy liên kết hoặc hợp đồng nằm ngoài phạm vi.
- SC-006 được đo khi có luồng sử dụng hoàn chỉnh; kiểm chứng phần xử lý dữ liệu riêng không thay thế kết quả nghiệm thu thao tác người dùng.
