# Feature Specification: Mã hồ sơ đăng ký dễ đọc

**Feature Branch**: `fix/001-registration-code-search` (bổ sung sau `feat/001-add-registration-id`)

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "Thêm trường registrationID để đánh số registration, giúp danh sách gọn hơn và minh bạch các đơn đăng ký. Định dạng là FP-REG-00001, các hồ sơ sau tăng số lên."

**Bổ sung đã xác nhận**: Tìm kiếm trong danh sách theo mã `registrationID`; API chi tiết tiếp tục tra theo UUID. Không đổi API chi tiết sang mã hồ sơ.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Nhận diện đơn đăng ký bằng mã dễ đọc (Priority: P1)

Là quản trị viên hệ thống có quyền xem hồ sơ đăng ký, tôi muốn mỗi đơn trong danh sách có mã dạng `FP-REG-00001` để dễ đọc, ghi nhận và đối chiếu hồ sơ mà không phải dùng chuỗi UUID dài.

**Why this priority**: Đây là mục tiêu chính của tính năng: cung cấp mã ngắn, thống nhất để trang danh sách dùng làm mã hồ sơ.

**Independent Test**: Tạo các hồ sơ trường học và nhà cung cấp rồi đọc danh sách bằng tài khoản có quyền. Kiểm tra mỗi hồ sơ có trường `registrationID` đúng định dạng, duy nhất và khớp với mã trong chi tiết hồ sơ.

**Acceptance Scenarios**:

1. **Given** hệ thống chưa từng cấp mã hồ sơ, **When** hai hồ sơ mới lần lượt được tạo thành công, **Then** mã tương ứng là `FP-REG-00001` và `FP-REG-00002`.
2. **Given** hồ sơ gần nhất được cấp mã `FP-REG-00009`, **When** một hồ sơ mới được tạo mà không có lần cấp số xen giữa, **Then** hồ sơ mới nhận mã `FP-REG-00010`.
3. **Given** quản trị viên có quyền xem danh sách, **When** đọc danh sách rồi mở chi tiết một hồ sơ, **Then** cả hai kết quả đều có cùng `registrationID`, đồng thời giữ nguyên định danh UUID hiện có.
4. **Given** tài khoản thiếu quyền xem hồ sơ, **When** cố đọc danh sách hoặc chi tiết, **Then** yêu cầu vẫn bị từ chối theo quy tắc phân quyền hiện hành dù người dùng biết mã hồ sơ.

---

### User Story 2 - Giữ mã nhất quán trong vòng đời hồ sơ (Priority: P2)

Là người nộp hồ sơ hoặc người xét duyệt có quyền, tôi muốn một hồ sơ luôn giữ cùng mã khi được chỉnh sửa, gửi lại hoặc xét duyệt để các bên có thể đối chiếu chính xác đơn đăng ký.

**Why this priority**: Mã thay đổi sau mỗi lần chỉnh sửa sẽ làm mất giá trị tham chiếu và gây nhầm lẫn khi trao đổi về cùng hồ sơ.

**Independent Test**: Nộp hồ sơ, đọc hồ sơ của mình, chỉnh sửa, từ chối, gửi lại và phê duyệt theo luồng hợp lệ hiện có; đối chiếu mã ở các bước.

**Acceptance Scenarios**:

1. **Given** hồ sơ đã có `registrationID`, **When** người nộp chỉnh sửa hồ sơ đang chờ duyệt hoặc gửi lại hồ sơ bị từ chối, **Then** mã vẫn giữ nguyên và không cấp số mới cho cùng hồ sơ.
2. **Given** hồ sơ đang chờ duyệt, **When** người có quyền phê duyệt hoặc từ chối thành công, **Then** mã vẫn giữ nguyên trong kết quả có chứa hồ sơ và các lần đọc sau đó.
3. **Given** người nộp đã có hồ sơ, **When** xem hồ sơ của mình, **Then** mã trùng với mã mà quản trị viên nhìn thấy; người chưa nộp hồ sơ vẫn nhận kết quả chưa có hồ sơ như hiện tại.
4. **Given** người dùng gửi kèm mã tự chọn khi nộp hoặc chỉnh sửa, **When** hệ thống kiểm tra yêu cầu, **Then** yêu cầu tự gán `registrationID` bị từ chối và mã đã cấp không thay đổi.

---

### User Story 3 - Đối chiếu được cả hồ sơ đã tồn tại (Priority: P2)

Là quản trị viên hệ thống, tôi muốn các hồ sơ đã có trước khi bổ sung tính năng cũng được cấp mã để danh sách sử dụng thống nhất một cách nhận diện.

**Why this priority**: Nếu hồ sơ cũ thiếu mã, người xét duyệt vẫn phải dùng UUID cho một phần danh sách.

**Independent Test**: Chuẩn bị các hồ sơ cũ thuộc cả hai loại và đủ ba trạng thái, trong đó có các hồ sơ cùng thời điểm nộp. Sau khi bổ sung mã, đối chiếu số lượng, nội dung hồ sơ và mã của hồ sơ được tạo tiếp theo.

**Acceptance Scenarios**:

1. **Given** đã có hồ sơ chờ duyệt, được duyệt và bị từ chối, **When** hoàn tất việc bổ sung mã, **Then** mọi hồ sơ đều có mã duy nhất; nội dung, trạng thái, người nộp, tài liệu và các mốc thời gian hiện có được giữ nguyên.
2. **Given** các hồ sơ cũ có thời điểm nộp khác nhau, **When** cấp mã ban đầu, **Then** đánh số từ 1 theo thời điểm nộp đang được lưu, sớm trước muộn sau; nếu trùng thời điểm thì dùng thứ tự UUID tăng dần để phân định.
3. **Given** hồ sơ cũ đã được cấp mã, **When** tiếp tục tạo hồ sơ mới, **Then** phần số của mã mới lớn hơn phần số lớn nhất đã cấp, không trùng và không đánh số lại hồ sơ cũ.

---

### User Story 4 - Tìm hồ sơ trong danh sách bằng mã đăng ký (Priority: P1)

Là quản trị viên có quyền xem hồ sơ, tôi muốn nhập mã `FP-REG-00001` để tìm đúng hồ sơ trong danh sách, rồi tiếp tục mở chi tiết và xét duyệt bằng UUID hiện có.

**Independent Test**: Gọi danh sách với `search` là mã của một hồ sơ có sẵn; kiểm tra chỉ hồ sơ đó được trả về, mã không tồn tại cho danh sách rỗng, và chi tiết vẫn nhận UUID.

**Acceptance Scenarios**:

1. **Given** hồ sơ có mã `FP-REG-00001`, **When** gọi `GET /api/registration-requests?search=FP-REG-00001`, **Then** danh sách chỉ chứa hồ sơ có đúng mã đó; không tìm theo UUID hoặc liên hệ người nộp.
2. **Given** từ khóa có khoảng trắng hai đầu hoặc chữ thường, **When** tìm `fp-reg-00001`, **Then** hệ thống chuẩn hóa và trả cùng kết quả như mã viết hoa.
3. **Given** không có mã tương ứng, **When** tìm một mã hợp lệ, **Then** trả HTTP 200 với `items: []`, giữ phân trang; bỏ `search` hoặc gửi chuỗi trắng tiếp tục trả danh sách như trước.
4. **Given** từ khóa sai định dạng, số không dương, vượt bigint PostgreSQL, dạng mảng/object hoặc tham số lạ, **When** gọi danh sách, **Then** trả 400 kèm đường dẫn trường, không lộ giá trị đầu vào và không truy vấn hồ sơ.
5. **Given** người dùng thiếu quyền hoặc sai phạm vi tổ chức, **When** tìm bằng mã có thật, **Then** vẫn bị từ chối; mã không tạo thêm quyền truy cập.
6. **Given** có kết quả tìm kiếm, **When** mở chi tiết bằng UUID `id` của kết quả, **Then** API chi tiết hoạt động theo hợp đồng cũ; gửi mã `FP-REG-…` vào đường dẫn chi tiết tiếp tục bị 400.

### Edge Cases

- Nhiều hồ sơ mới được nộp đồng thời: mỗi hồ sơ được lưu thành công phải có mã riêng; thứ tự hoàn tất các yêu cầu đồng thời không bắt buộc trùng thứ tự cấp số.
- Một lần nộp bị lỗi hoặc bị hủy: không tạo ra hồ sơ thành công thiếu mã; được phép bỏ trống số đã cấp cho lần thất bại và không dùng lại số đó.
- Chuyển từ `FP-REG-99999` sang hồ sơ tiếp theo: mã mở rộng thành `FP-REG-100000`, không quay vòng hoặc cắt mất chữ số.
- Danh sách rỗng, chuyển trang hoặc thay đổi thứ tự hiển thị: không sinh mã mới, không đánh số lại; mã hồ sơ không phải số thứ tự của dòng.
- Có hồ sơ cũ trùng thời điểm nộp hoặc đã từng gửi lại: dùng thời điểm nộp đang được lưu để cấp mã ban đầu; mã không khẳng định thứ tự nộp lần đầu trong quá khứ.
- Đổi ngày, năm hoặc tạo xen kẽ hồ sơ trường học và nhà cung cấp: tiếp tục cùng dãy số, không khởi động lại việc đánh số.
- Tìm mã sau 99999 và mã có phần số vượt `Number.MAX_SAFE_INTEGER`: đối chiếu chính xác trong dải bigint dương, không làm tròn qua Number. Chỉ nhận dạng chuẩn với tối thiểu 5 chữ số, không thêm số 0 dư khi phần số dài hơn 5 chữ số.
- Tìm đúng mã nhưng yêu cầu trang sau: áp dụng phân trang trên tập kết quả đã lọc, không trả lại hồ sơ ở mọi trang.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Mỗi hồ sơ đăng ký PHẢI có thêm một trường `registrationID` dùng làm mã dễ đọc, duy nhất trên toàn bộ hồ sơ đăng ký. Mỗi mã chỉ thuộc một hồ sơ.
- **FR-002**: Mã PHẢI gồm tiền tố cố định viết hoa `FP-REG-` và phần số nguyên dương viết bằng chữ số thập phân, thêm số 0 bên trái cho đủ tối thiểu 5 chữ số. Ví dụ: `FP-REG-00001`, `FP-REG-00010`, `FP-REG-100000`. Không cắt bớt chữ số khi vượt 99999.
- **FR-003**: Dãy số PHẢI bắt đầu từ 1 và dùng chung cho hồ sơ trường học và nhà cung cấp trên toàn hệ thống; không đặt lại theo ngày, năm, loại hồ sơ, tổ chức hoặc trang danh sách.
- **FR-004**: Hệ thống PHẢI tự cấp mã khi tạo hồ sơ lần đầu. Người dùng không được tự gán hoặc thay đổi `registrationID`; yêu cầu nộp hoặc chỉnh sửa chứa trường này PHẢI bị từ chối.
- **FR-005**: Mỗi lần cấp số mới PHẢI tăng so với lần cấp trước và không trùng kể cả khi có yêu cầu đồng thời. Mã đã cấp không được dùng lại. Cho phép có khoảng trống do thao tác thất bại; mã không biểu thị tổng số hồ sơ hay thứ tự hoàn tất các yêu cầu đồng thời.
- **FR-006**: Mã PHẢI được giữ nguyên khi chỉnh sửa, gửi lại sau từ chối, phê duyệt hoặc từ chối cùng hồ sơ. Các thao tác này không cấp số mới cho hồ sơ đã tồn tại.
- **FR-007**: Mọi kết quả hiện có chứa hồ sơ đăng ký PHẢI cung cấp `registrationID` nhất quán, bao gồm danh sách xét duyệt, chi tiết xét duyệt, hồ sơ của người nộp và kết quả nộp, phê duyệt, từ chối nếu kết quả đó chứa hồ sơ. Trường hợp chưa có hồ sơ tiếp tục trả kết quả như hiện tại.
- **FR-008**: Tất cả hồ sơ đã tồn tại PHẢI được bổ sung mã trước khi tính năng được đưa vào sử dụng, bắt đầu từ 1 theo thời điểm nộp đang được lưu tăng dần; trường hợp trùng thời điểm dùng UUID tăng dần để phân định. Việc này không được thay đổi nội dung, trạng thái, liên kết hoặc các mốc thời gian hiện có.
- **FR-009**: Sau khi bổ sung mã cho hồ sơ cũ, lần cấp số tiếp theo PHẢI lớn hơn số lớn nhất đã cấp. Không được đánh số lại các hồ sơ đã có mã.
- **FR-010**: UUID hiện có PHẢI được giữ nguyên để các liên kết và thao tác đang sử dụng tiếp tục hoạt động. Việc bổ sung mã không thay đổi cấu trúc kết quả thành công/lỗi hiện có, phân trang hoặc thứ tự danh sách hiện hành.
- **FR-011**: Quyền xem, chỉnh sửa và xét duyệt hồ sơ PHẢI giữ nguyên. Biết hoặc đoán được `registrationID` không cấp quyền truy cập; chỉ những hồ sơ người dùng vốn được phép xem mới được cung cấp mã.
- **FR-012**: Nếu không thể tạo hồ sơ kèm mã hợp lệ, hệ thống PHẢI thông báo thất bại theo cách xử lý lỗi hiện có; không được báo nộp thành công với hồ sơ thiếu mã hoặc trùng mã.
- **FR-013**: Danh sách PHẢI nhận thêm query `search` tùy chọn để tìm chính xác mã `registrationID` đầy đủ. Trim khoảng trắng hai đầu và chuẩn hóa chữ hoa; chuỗi rỗng sau trim tương đương không lọc. Không tìm bằng UUID, tên hoặc thông tin liên hệ.
- **FR-014**: `search` PHẢI là một chuỗi mã chuẩn có phần số từ 1 đến 9223372036854775807; mã sau 99999 tiếp tục hợp lệ. Từ khóa không hợp lệ PHẢI trả 400 theo envelope validation với field `search` và không lộ đầu vào. Bộ lọc PHẢI được áp dụng trước phân trang và kết hợp với phạm vi truy cập hiện hành; mã không tồn tại trả danh sách rỗng HTTP 200.
- **FR-015**: API chi tiết, duyệt, từ chối và tài liệu PHẢI tiếp tục dùng UUID trong đường dẫn. Việc tìm kiếm không thay đổi UUID, cấu trúc response, thứ tự danh sách, quyền hoặc schema database.

### Key Entities

- **Hồ sơ đăng ký**: Đơn đăng ký của trường học hoặc nhà cung cấp, có người nộp, trạng thái, thời điểm nộp, nội dung và tài liệu; nay có thêm mã dễ đọc trong khi giữ nguyên định danh UUID.
- **Mã hồ sơ `registrationID`**: Giá trị tham chiếu duy nhất dạng `FP-REG-00001`, được cấp tự động và cố định trong vòng đời của một hồ sơ; không phải số dòng hay bằng chứng về tổng số đơn.
- **Người tham gia hồ sơ**: Người nộp xem hồ sơ của mình và quản trị viên hệ thống xem hoặc xét duyệt theo quyền hiện hành; mã mới không mở rộng phạm vi truy cập.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% hồ sơ cũ và mới trong dữ liệu nghiệm thu có mã đúng định dạng, không thiếu và không trùng; mã trong danh sách khớp với mã trong chi tiết và hồ sơ của người nộp.
- **SC-002**: Trong dải số từ 1 đến 99999, mỗi mã dài 12 ký tự, giảm hai phần ba số ký tự cần dùng so với UUID chuẩn có dấu gạch ngang dài 36 ký tự.
- **SC-003**: Khi 100 người nộp khác nhau gửi hồ sơ mới đồng thời trong điều kiện hợp lệ, tất cả hồ sơ được lưu thành công có mã riêng; không có hồ sơ thành công thiếu mã.
- **SC-004**: 100% kịch bản chỉnh sửa, từ chối, gửi lại và phê duyệt giữ nguyên mã của cùng hồ sơ; toàn bộ hồ sơ cũ giữ nguyên nội dung, liên kết và các mốc thời gian sau khi bổ sung mã.
- **SC-005**: 100% kịch bản nghiệm thu thiếu quyền hoặc xem hồ sơ ngoài phạm vi tiếp tục bị từ chối theo quy tắc hiện hành, kể cả khi người dùng biết mã mới.
- **SC-006**: Các kịch bản tìm mã có thật/không tồn tại, chuẩn hóa, bigint lớn, trang sau, validation và thiếu quyền đều đạt; API chi tiết tiếp tục tra theo UUID.

## Assumptions

- Định dạng `FP-REG-00001` và việc tăng phần số cho các hồ sơ sau là yêu cầu người dùng đã xác nhận. Các quy tắc còn lại là mặc định nghiệp vụ được ghi rõ trong đặc tả này.
- Dãy số dùng chung toàn hệ thống vì danh sách xét duyệt hiện tại phục vụ quản trị viên hệ thống cho cả trường học và nhà cung cấp; chưa có yêu cầu chia dãy số theo tổ chức hay theo năm.
- Số tăng và không trùng là mục tiêu; không yêu cầu dãy số liền mạch tuyệt đối. Khoảng trống không được diễn giải là có hồ sơ bị che giấu.
- Luồng hiện tại chỉnh sửa hoặc gửi lại cùng hồ sơ thay vì tạo một hồ sơ độc lập cho mỗi lần nộp, nên mã được giữ nguyên qua các lần này.
- Dữ liệu hiện có chỉ bảo đảm thời điểm nộp đang lưu; đánh số hồ sơ cũ theo mốc đó không nhằm khôi phục lịch sử nộp lần đầu.
- Phạm vi trong kho mã hiện tại là bổ sung mã và cung cấp mã trong dữ liệu hồ sơ. Trang danh sách cần được tích hợp để hiển thị `registrationID` thay UUID trong ứng dụng quản trị tương ứng; thay đổi bố cục giao diện không thuộc phạm vi này.
- Bổ sung tìm chính xác mã qua `search` trong danh sách theo yêu cầu mới; chưa bổ sung tìm một phần mã, bộ lọc khác, cách sắp xếp mới, lịch sử xét duyệt, báo cáo công khai hoặc thay đổi nội dung email.
- Việc triển khai và bổ sung mã cho dữ liệu hiện có phải được lập kế hoạch, kiểm tra và thực hiện theo quy trình thay đổi dữ liệu của dự án. Giai đoạn đặc tả không thay đổi cơ sở dữ liệu.
