# Feature Specification: Upload ảnh nguyên liệu và helper ảnh/tài liệu dùng chung

**Feature Branch**: `feat/ingredient-image-upload`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Tôi muốn thêm tính năng upload ảnh nguyên liệu lên Cloudinary, tôi nghĩ là nên tạo ra 1 hàm helper chung để các tính năng khác có thể tái sử dụng nó."

## Clarifications

### Session 2026-11-14

- Q: Cần chia helper dùng chung thành những thao tác nào? → A: Bốn hàm riêng: upload đúng một ảnh, upload từ một đến tối đa năm ảnh, upload đúng một tài liệu và upload từ một đến tối đa năm tài liệu.
- Q: Hai hàm upload tài liệu cần chấp nhận những định dạng nào? → A: Phương án A — PDF, PNG và JPEG.
- Q: Khi upload nhiều tệp mà một tệp bị lỗi, bạn muốn xử lý thế nào? → A: Phương án A — trả kết quả thành công/thất bại cho từng tệp theo thứ tự đầu vào, giữ tệp thành công và chỉ cần thử lại tệp lỗi.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Tải ảnh để thêm hoặc sửa nguyên liệu (Priority: P1)

Quản trị nhà cung cấp tải ảnh từ thiết bị, dùng kết quả làm ảnh bìa hoặc ảnh mô tả khi thêm/sửa nguyên liệu.

**Why this priority**: Cho phép nhà cung cấp tự bổ sung ảnh mà không phải chuẩn bị đường dẫn ảnh từ trước.

**Independent Test**: Tải ảnh bằng tài khoản quản trị đủ quyền, dùng đường dẫn trả về để tạo/sửa nguyên liệu rồi đọc lại và mở ảnh.

**Acceptance Scenarios**:

1. **Given** quản trị đủ quyền chưa tạo nguyên liệu, **When** tải một ảnh hợp lệ, **Then** nhận đường dẫn HTTPS và thông tin ảnh, không phát sinh bản ghi nguyên liệu.
2. **Given** ảnh đã tải thành công, **When** lưu đường dẫn vào `coverImage`, **Then** đọc lại đúng ảnh bìa đã chọn.
3. **Given** ba ảnh đã tải thành công trong một lần upload nhiều ảnh, **When** lưu đường dẫn vào `imageDescription` theo thứ tự đã chọn, **Then** đọc lại đủ ba đường dẫn theo đúng thứ tự.
4. **Given** nguyên liệu đã có ảnh, **When** tải ảnh mới nhưng chưa lưu sửa nguyên liệu, **Then** ảnh đang lưu không thay đổi.
5. **Given** upload đã thành công nhưng lưu nguyên liệu thất bại vì lỗi nghiệp vụ, **When** sửa thông tin rồi lưu lại với cùng đường dẫn, **Then** không bắt buộc tải lại ảnh chỉ vì lần lưu trước thất bại.

---

### User Story 2 - Chặn upload không hợp lệ và báo lỗi rõ ràng (Priority: P1)

Quản trị nhận thông báo tiếng Việt khi tệp không phù hợp hoặc dịch vụ gặp lỗi; người không có quyền không được tải tệp lên.

**Why this priority**: Bảo vệ tài nguyên lưu trữ và giữ đúng quyền quản trị nguyên liệu hiện hành.

**Independent Test**: Kiểm tra giới hạn dung lượng, giả định dạng, thiếu/thừa ảnh, tài khoản sai quyền và lỗi dịch vụ bằng môi trường kiểm thử kiểm soát được.

**Acceptance Scenarios**:

1. **Given** người chưa đăng nhập, staff, System Admin hoặc quản trị bị thu hồi quyền, **When** yêu cầu upload, **Then** bị từ chối trước khi gửi tệp sang dịch vụ lưu ảnh.
2. **Given** ảnh JPEG/PNG/WebP hợp lệ, dung lượng lớn hơn 0 và không quá 5 MiB, **When** tải đúng một ảnh, **Then** được chấp nhận; ảnh đúng 5 MiB vẫn trong giới hạn.
3. **Given** tệp rỗng, quá dung lượng, không phải ảnh hoặc nội dung không khớp loại khai báo, **When** tải lên, **Then** nhận lỗi tiếng Việt và không gửi tệp sang dịch vụ lưu ảnh.
4. **Given** yêu cầu thiếu tệp, vượt số lượng của thao tác tương ứng hoặc chứa dữ liệu ngoài hợp đồng upload, **When** xử lý, **Then** từ chối toàn bộ yêu cầu.
5. **Given** thiếu cấu hình lưu ảnh hoặc có lỗi dịch vụ/hết thời gian chờ hữu hạn, **When** upload, **Then** nhận lỗi chung an toàn nếu không thể bắt đầu lượt upload, hoặc kết quả lỗi cho từng tệp bị ảnh hưởng nếu lượt đã bắt đầu; không có kết quả thành công giả và nguyên liệu đang lưu không thay đổi.

---

### User Story 3 - Dùng lại khả năng upload ảnh và tài liệu (Priority: P2)

Nhóm phát triển có bốn hàm dùng chung: upload một ảnh, upload tối đa năm ảnh, upload một tài liệu và upload tối đa năm tài liệu. Các tính năng chọn đúng thao tác mà không sao chép logic tích hợp lưu trữ.

**Why this priority**: Đáp ứng yêu cầu tái sử dụng từ người dùng ngay trong tính năng đầu tiên.

**Independent Test**: Kiểm chứng upload ảnh nguyên liệu và bốn hàm trong một ngữ cảnh gọi độc lập; không cần xây thêm nghiệp vụ tài liệu hoặc API tài liệu mới.

**Acceptance Scenarios**:

1. **Given** ngữ cảnh gọi đã xác thực quyền và cung cấp đúng một tệp hợp lệ, **When** dùng hàm một ảnh hoặc một tài liệu tương ứng, **Then** nhận một kết quả tài nguyên, không bắt buộc có mã nguyên liệu.
2. **Given** hai ngữ cảnh có phạm vi lưu do hệ thống xác lập, **When** tải ảnh trùng tên tệp gốc, **Then** ảnh có định danh riêng và không ghi đè nhau.
3. **Given** luồng tài liệu đăng ký hiện có, **When** bổ sung bộ helper, **Then** tài liệu đăng ký vẫn giữ chính sách riêng tư, giới hạn số lượng và hành vi hiện hành; không tự chuyển luồng này sang giới hạn năm tệp.
4. **Given** danh sách từ một đến năm ảnh hoặc từ một đến năm tài liệu hợp lệ, **When** dùng hàm nhiều tệp đúng loại, **Then** nhận danh sách kết quả tương ứng theo thứ tự đầu vào khi cả lượt thành công.
5. **Given** danh sách rỗng, sáu tệp hoặc hai tệp gửi vào hàm một tệp, **When** kiểm tra đầu vào, **Then** bị từ chối trước khi gửi bất kỳ tệp nào tới Cloudinary.
6. **Given** danh sách có một tệp không hợp lệ, **When** gọi hàm nhiều tệp, **Then** phát hiện lỗi trước khi gửi bất kỳ tệp nào trong danh sách sang Cloudinary.
7. **Given** tài liệu PDF, PNG hoặc JPEG hợp lệ trong giới hạn dung lượng, **When** gọi hàm một tài liệu hoặc nhiều tài liệu với đúng số lượng, **Then** nhận kết quả tài nguyên tương ứng, giữ chính sách truy cập riêng tư mặc định; danh sách tài liệu được phép chứa hỗn hợp ba định dạng này.
8. **Given** tài liệu có định dạng khác hoặc nội dung không khớp loại khai báo, **When** gọi một trong hai hàm tài liệu, **Then** bị từ chối trước khi gửi bất kỳ tệp nào của lượt đó sang Cloudinary.
9. **Given** lượt năm tệp hợp lệ nhưng hai tệp bị lỗi khi gửi tới dịch vụ lưu trữ, **When** lượt upload kết thúc, **Then** nhận đủ năm kết quả theo thứ tự đầu vào: ba thành công kèm thông tin tài nguyên và hai thất bại kèm lỗi an toàn; ba tài nguyên thành công được giữ lại và có thể sử dụng ngay.
10. **Given** một lượt nhiều tệp đều thất bại ở dịch vụ lưu trữ, **When** trả kết quả, **Then** mỗi tệp đều có kết quả thất bại, không tệp nào được báo thành công hoặc nhận đường dẫn giả.
11. **Given** lượt upload đã có cả tệp thành công và thất bại, **When** bên gọi gửi lại riêng các tệp thất bại, **Then** các tài nguyên thành công trước đó được giữ nguyên và không bị tải lại bởi helper trong lần thử lại này.

### Edge Cases

- Nhà cung cấp không ACTIVE hoặc tài khoản thiếu quan hệ SUPPLIER hợp lệ: từ chối dù đúng vai trò.
- Người dùng gửi mã nhà cung cấp, thư mục hoặc định danh ảnh để điều khiển nơi lưu/ghi đè: từ chối dữ liệu đó; phạm vi lưu do hệ thống xác lập.
- Hai nhà cung cấp upload ảnh cùng tên, kể cả đồng thời: không ghi đè và phân biệt được phạm vi lưu.
- Đổi phần mở rộng, giả MIME hoặc ảnh không giải mã được không đủ điều kiện chấp nhận. SVG, GIF, PDF và video không thuộc định dạng của hàm ảnh; hàm tài liệu chỉ nhận PDF, PNG và JPEG, không nhận WebP, DOCX hoặc XLSX.
- Lượt nhiều tệp giữ thứ tự đầu vào khi trả kết quả, kể cả khi các tệp hoàn tất upload theo thứ tự khác nhau.
- Lỗi upload của một tệp không ngăn các tệp hợp lệ còn lại được xử lý. Kết quả có đúng một phần tử cho mỗi tệp đầu vào, kể cả khi tất cả tệp đều thất bại ở dịch vụ lưu trữ; không tự xóa các tài nguyên đã thành công.
- Mất kết nối sau khi dịch vụ có thể đã nhận ảnh: không báo thành công khi chưa có xác nhận. Thử lại có thể tạo ảnh mới; không cam kết tự dọn ảnh chưa được gắn vào nguyên liệu.
- Bỏ/thay tham chiếu ảnh hoặc ẩn nguyên liệu không tự xóa tài nguyên ảnh tại dịch vụ lưu trữ trong phạm vi này.
- Ảnh nguyên liệu công khai: ai biết URL có thể mở ảnh; quyền upload không làm ảnh có chính sách riêng tư như tài liệu đăng ký.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Chỉ tài khoản ACTIVE có vai trò `INGREDIENT_SUPPLIER_ADMIN`, tổ chức SUPPLIER hợp lệ đang ACTIVE và quyền hiệu lực `ingredient.manage` được upload ảnh nguyên liệu. Staff và vai trò khác, kể cả System Admin, không có quyền truy cập ngầm.
- **FR-002**: Kiểm tra đăng nhập và quyền trước khi xử lý tệp upload. Phạm vi nhà cung cấp lấy từ danh tính và quan hệ tổ chức hiện tại đã xác thực, không từ dữ liệu người dùng gửi.
- **FR-003**: Hỗ trợ upload trước khi tạo hoặc lưu sửa nguyên liệu, không yêu cầu mã nguyên liệu. Upload không tự tạo hay cập nhật nguyên liệu.
- **FR-004**: Upload ảnh nguyên liệu hỗ trợ hai thao tác riêng: đúng một ảnh và danh sách từ một đến tối đa năm ảnh trong một lượt. Nhận tệp từ thiết bị; không hỗ trợ lấy ảnh từ URL, đường dẫn trên máy chủ hoặc nội dung ảnh dạng văn bản. Thiếu/thừa tệp so với thao tác hoặc trường ngoài hợp đồng phải bị từ chối toàn bộ.
- **FR-005**: Chấp nhận JPEG, PNG và WebP có dung lượng lớn hơn 0, tối đa 5 MiB (5.242.880 byte) mỗi ảnh. Nội dung phải khớp loại khai báo và được xác nhận là ảnh hợp lệ; tên/phần mở rộng đơn thuần không đủ. Không chấp nhận định dạng khác.
- **FR-006**: Lưu ảnh tại Cloudinary theo yêu cầu người dùng. Chỉ đánh dấu một tệp thành công khi nhận kết quả upload của tệp đó được xác nhận với đường dẫn HTTPS sử dụng được; không trả toàn bộ phản hồi nội bộ của dịch vụ. Một tệp thành công không đồng nghĩa mọi tệp trong lượt đều thành công.
- **FR-007**: Kết quả gồm đường dẫn HTTPS, định danh tài nguyên, định dạng, dung lượng và chiều rộng/chiều cao ảnh. Không lộ credential hoặc thông tin cấu hình nhạy cảm.
- **FR-008**: Đường dẫn trả về dùng được trong `coverImage` và `imageDescription` hiện có. Giữ tối đa một ảnh bìa, danh sách ảnh mô tả theo thứ tự và quy tắc sửa: bỏ qua giữ nguyên, `null` bỏ ảnh bìa, `[]` xóa danh sách tham chiếu ảnh mô tả.
- **FR-009**: Hệ thống xác lập phạm vi lưu theo nhà cung cấp/ngữ cảnh và định danh ảnh riêng. Người dùng không được chọn chủ sở hữu, nơi lưu hoặc định danh ghi đè. Các lần upload thành công không ghi đè tài nguyên hiện có dù trùng tên tệp hoặc diễn ra đồng thời.
- **FR-010**: Có bốn hàm dùng chung, không phụ thuộc riêng vào nguyên liệu: upload đúng một ảnh, upload từ một đến năm ảnh, upload đúng một tài liệu và upload từ một đến năm tài liệu. Hàm một tệp trả một kết quả tài nguyên hoặc báo lỗi; hàm nhiều tệp trả danh sách kết quả thành công/thất bại theo thứ tự đầu vào sau khi lượt kết thúc, theo FR-019. Các hàm dùng chung quy tắc tích hợp Cloudinary, nhận tệp và ngữ cảnh lưu tin cậy; tính năng gọi chịu trách nhiệm phân quyền và xác lập phạm vi.
- **FR-011**: Luồng nguyên liệu dùng các hàm ảnh của bộ helper. Hai hàm tài liệu được triển khai để tái sử dụng và kiểm chứng độc lập, không bổ sung tài liệu vào nguyên liệu, API tài liệu chung hoặc nghiệp vụ tài liệu mới. Không tự chuyển luồng tài liệu đăng ký hiện có sang helper mới.
- **FR-012**: Tệp sai và người không đủ quyền bị từ chối trước khi gửi tới dịch vụ lưu trữ. Thiếu cấu hình hoặc lỗi chung khiến không thể bắt đầu lượt upload phải báo lỗi chung; lỗi dịch vụ/hết thời gian chờ của từng tệp trong lượt nhiều tệp phải được biểu diễn ở phần tử tương ứng theo FR-019. Lỗi phải có thông báo tiếng Việt an toàn; luồng HTTP giữ envelope hiện hành và không lộ phản hồi kỹ thuật/secret của Cloudinary.
- **FR-013**: Upload hoặc lỗi upload không thay đổi dữ liệu, chủ sở hữu, trạng thái hay ảnh của nguyên liệu đã lưu. Chỉ luồng tạo/sửa hiện có lưu tham chiếu ảnh sau khi vượt qua phân quyền và kiểm tra nghiệp vụ của luồng đó.
- **FR-014**: Giữ tương thích tham chiếu ảnh cũ và quy tắc nhận URL/đường dẫn hiện hành khi tạo/sửa nguyên liệu. Không bắt buộc chuyển ảnh cũ sang Cloudinary hoặc bổ sung xác minh quyền sở hữu mọi URL ảnh trong phạm vi này.
- **FR-015**: Ảnh nguyên liệu có đường dẫn công khai. Không thay đổi chính sách riêng tư, mở/tải và lưu trữ tài liệu đăng ký hiện có.
- **FR-016**: Giữ rate limit chung hiện hành. Phạm vi không gồm xóa ảnh, thư viện ảnh, cắt/chỉnh ảnh, lượt upload trên năm tệp, dọn ảnh chưa sử dụng, giao diện người dùng hoặc thay đổi dữ liệu/schema nguyên liệu.

- **FR-017**: Hàm một tệp nhận đúng một tệp; hàm nhiều tệp nhận từ một đến năm tệp cùng nhóm ảnh hoặc tài liệu. Danh sách rỗng, vượt năm tệp, trộn loại không được phép hoặc một tệp sai phải được phát hiện trước khi gửi bất kỳ tệp nào sang Cloudinary. Giới hạn năm áp dụng cho mỗi lượt upload, không tự áp đặt giới hạn tổng số tham chiếu `imageDescription` đã lưu.
- **FR-018**: Hai hàm tài liệu chỉ chấp nhận PDF, PNG và JPEG, dung lượng lớn hơn 0 và không quá 5 MiB mỗi tệp theo mặc định đề xuất. Nội dung phải khớp loại khai báo; chỉ đổi phần mở rộng không đủ để chấp nhận. Hàm nhiều tài liệu cho phép kết hợp các định dạng được hỗ trợ trong cùng lượt. Không bắt buộc kết quả tài liệu có chiều rộng/chiều cao như ảnh.
- **FR-019**: Sau khi toàn bộ đầu vào hợp lệ và bắt đầu upload nhiều tệp, phải trả đúng một kết quả cho mỗi tệp theo thứ tự đầu vào, kể cả khi một số hoặc tất cả tệp gặp lỗi dịch vụ. Mỗi phần tử xác định được vị trí tệp đầu vào và trạng thái thành công/thất bại. Thành công kèm thông tin tài nguyên theo loại; thất bại kèm mã lỗi và thông báo tiếng Việt an toàn, không kèm thông tin tài nguyên thành công giả. Lỗi một tệp không dừng xử lý các tệp còn lại. Giữ nguyên các tài nguyên đã thành công, không rollback/xóa; bên gọi có thể dùng các kết quả này và gửi lại riêng tệp lỗi. Không trả danh sách kết quả upload cho đầu vào sai hoặc lỗi chung trước khi lượt bắt đầu.
- **FR-020**: Phân biệt chính sách truy cập của ảnh nguyên liệu công khai và tài liệu. Helper tài liệu mặc định lưu riêng tư, chỉ cho phép chính sách truy cập do tính năng gọi tin cậy xác lập; không tự công khai tài liệu. Không mở thêm API tải/xem tài liệu trong tính năng này.

### Key Entities

- **Ảnh đã upload**: Tài nguyên có định danh, đường dẫn HTTPS, định dạng, dung lượng, kích thước và phạm vi nghiệp vụ/nhà cung cấp do hệ thống xác lập; có thể chưa được gắn vào nguyên liệu.
- **Tài liệu đã upload**: Tài nguyên tài liệu có định danh, tên tệp, định dạng, dung lượng và chính sách truy cập; không bắt buộc có kích thước ảnh hoặc URL công khai. Không tự tạo quan hệ tài liệu với nguyên liệu.
- **Lượt upload nhiều tệp**: Nhóm từ một đến năm ảnh hoặc từ một đến năm tài liệu, giữ tương ứng giữa thứ tự tệp đầu vào và kết quả. Mỗi kết quả có vị trí đầu vào, trạng thái và thông tin tài nguyên nếu thành công hoặc lỗi an toàn nếu thất bại; không hoàn tác tệp đã thành công.
- **Tham chiếu ảnh nguyên liệu**: `coverImage` và các phần tử `imageDescription`; chỉ lưu qua thao tác tạo/sửa nguyên liệu thành công. Upload thành công không đồng nghĩa lưu nguyên liệu thành công.
- **Ngữ cảnh upload tin cậy**: Thông tin bên gọi xác lập để phân biệt mục đích và phạm vi lưu; không phải dữ liệu người dùng tùy ý nhập.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Trong bộ nghiệm thu, 100% ảnh JPEG/PNG/WebP hợp lệ trong giới hạn tải thành công khi dịch vụ hoạt động; kết quả có URL HTTPS mở được và đủ thông tin đã công bố.
- **SC-002**: Hoàn thành được cả hành trình thêm và sửa nguyên liệu bằng ảnh từ thiết bị; đọc lại đúng ảnh bìa và thứ tự ba ảnh mô tả đã lưu.
- **SC-003**: 100% trường hợp không đủ quyền, thiếu/thừa tệp, tệp rỗng, vượt dung lượng hoặc sai định dạng trong bộ nghiệm thu bị từ chối trước khi gửi tệp sang dịch vụ lưu ảnh.
- **SC-004**: Kiểm thử ít nhất 10 upload đồng thời cùng tên tệp gốc, phân bố ở hai nhà cung cấp: mọi lần thành công có định danh riêng, không ảnh hiện có nào bị ghi đè.
- **SC-005**: 100% tình huống lỗi cấu hình, lỗi dịch vụ và hết thời gian chờ được kiểm thử có lỗi an toàn ở cấp lượt hoặc cấp tệp đúng FR-012/FR-019; không nguyên liệu đã lưu nào thay đổi và không thông tin bí mật nào bị lộ.
- **SC-006**: Một ngữ cảnh kiểm thử độc lập dùng được cả bốn hàm theo hợp đồng tương ứng; bộ kiểm thử tài liệu đăng ký hiện có tiếp tục đạt.
- **SC-007**: Cả hai hàm nhiều tệp chấp nhận lượt một và năm tệp hợp lệ, giữ thứ tự đầu vào khi thành công; cả bốn hàm từ chối sai số lượng và tệp không hợp lệ trước khi gửi dữ liệu sang Cloudinary.
- **SC-008**: Trong bộ nghiệm thu, cả hai hàm tài liệu chấp nhận PDF, PNG và JPEG hợp lệ, bao gồm lượt kết hợp ba định dạng; 100% trường hợp sai định dạng hoặc nội dung không khớp khai báo bị từ chối trước khi gửi tệp sang dịch vụ lưu trữ.
- **SC-009**: Với cả hai hàm nhiều tệp, kiểm thử lượt năm tệp có hai lỗi dịch vụ và lượt tất cả tệp lỗi: số lượng/thứ tự kết quả đúng đầu vào, trạng thái đúng từng tệp, các tài nguyên thành công vẫn dùng được. Thử lại riêng tệp lỗi không làm helper tải lại hoặc xóa tài nguyên đã thành công.

## Assumptions

- Kế thừa quyền từ [spec quản lý nguyên liệu](../008-supplier-ingredient-management/spec.md); không thêm vai trò hay quyền mới. Đây là phần mở rộng khả năng lấy ảnh.
- Chọn upload trước rồi gửi URL khi lưu để hỗ trợ cả lúc chưa có mã nguyên liệu và giữ luồng lưu hiện hành.
- Bốn hàm, giới hạn năm tệp mỗi lượt nhiều tệp và định dạng tài liệu PDF/PNG/JPEG đã được người dùng xác nhận. Ảnh giữ JPEG/PNG/WebP tối đa 5 MiB mỗi tệp; tài liệu mặc định đề xuất tối đa 5 MiB mỗi tệp. Lượt năm tệp vì vậy có tổng nội dung tệp tối đa 25 MiB, chưa kể dữ liệu đóng gói.
- Đã xác nhận xử lý lỗi dịch vụ theo từng tệp cho hai hàm nhiều tệp; không thêm cơ chế rollback hoặc xóa các tài nguyên thành công. Kiểm tra đầu vào vẫn áp dụng cho toàn bộ danh sách trước lần gửi đầu tiên.
- Ảnh nguyên liệu là nội dung công khai giới thiệu sản phẩm. Xóa ảnh vật lý và quản lý ảnh chưa sử dụng cần yêu cầu riêng.
- Cloudinary và bộ bốn hàm dùng chung là ràng buộc do người dùng nêu. Đặc tả không quyết định tên hàm, SDK, cấu trúc code hoặc chi tiết giao tiếp kỹ thuật; không đổi hành vi tài liệu đăng ký.
- Phụ thuộc tài khoản và cấu hình Cloudinary hợp lệ do người vận hành cung cấp qua cơ chế cấu hình bí mật; không ghi khóa thật vào mã/tài liệu. Kiểm thử tự động không bắt buộc dùng tài khoản lưu ảnh thật.
