# Feature Specification: Tra cứu và xem chi tiết trường học, nhà cung cấp

**Feature Branch**: `feat/006-school-list`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Mở rộng danh sách trường học và nhà cung cấp với tìm kiếm, lọc trạng thái, thông tin liên hệ, tổng kết quả; bổ sung thống kê và dữ liệu chi tiết cho SA-04, SA-08, gồm lớp học, liên kết, tài khoản, chứng nhận và xem minh chứng có kiểm tra quyền."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Tra cứu toàn bộ danh sách đơn vị (Priority: P1)

System Admin có quyền xem muốn tìm trường theo tên/mã trường hoặc nhà cung cấp theo tên/mã số thuế, lọc trạng thái và xem đủ thông tin liên hệ. Kết quả phải phản ánh toàn bộ phạm vi được phép xem, kể cả đơn vị nằm ngoài trang đang tải.

**Why this priority**: Khắc phục việc chỉ tìm trong vài dòng hiện tại và cung cấp dữ liệu đủ để hiển thị bảng lẫn thẻ trên thiết bị di động.

**Independent Test**: Chuẩn bị trên 5 đơn vị mỗi loại, đặt bản ghi khớp tìm kiếm ở ngoài trang đầu và xác minh tìm kiếm, lọc, số kết quả và điều hướng.

**Acceptance Scenarios**:

1. **Given** bản ghi phù hợp nằm ngoài 5 dòng đầu, **When** tìm bằng một phần tên hoặc mã tương ứng, **Then** bản ghi xuất hiện trong tập kết quả và tổng số phản ánh toàn bộ kết quả khớp.
2. **Given** đơn vị có cả hai trạng thái, **When** kết hợp tìm kiếm với ACTIVE hoặc INACTIVE, **Then** mọi kết quả đồng thời thỏa cả hai điều kiện trước khi chia trang.
3. **Given** kết quả có 12 đơn vị và kích thước trang là 5, **When** lần lượt xem ba trang, **Then** nhận 5, 5, 2 dòng; tổng số luôn là 12; chỉ hai trang đầu có trang kế tiếp.
4. **Given** đơn vị thiếu thông tin liên hệ, **When** xem danh sách, **Then** email, điện thoại, địa chỉ vẫn hiện diện trong dữ liệu với giá trị null ở trường chưa có.
5. **Given** người dùng tổ chức có quyền đọc hiện hành, **When** tìm hoặc lọc danh sách, **Then** kết quả và tổng số chỉ bao gồm phạm vi vốn được phép đọc của người đó.

---

### User Story 2 - Xem tổng quan số lượng đơn vị (Priority: P1)

System Admin có quyền xem muốn biết tổng số trường/nhà cung cấp và số đơn vị đang ACTIVE để sử dụng hai card tổng quan.

**Why this priority**: Hai số tổng quan phải có dữ liệu thực và ý nghĩa độc lập với thao tác tìm kiếm trong danh sách.

**Independent Test**: Với mỗi loại gồm 100 đơn vị, trong đó 85 ACTIVE, xác minh tổng quan luôn là 100 và 85 khi thay đổi tìm kiếm, trạng thái hoặc trang danh sách.

**Acceptance Scenarios**:

1. **Given** 100 đơn vị gồm 85 ACTIVE và 15 INACTIVE trong phạm vi được xem, **When** xem tổng quan, **Then** tổng số là 100 và số đang hoạt động là 85.
2. **Given** danh sách đang lọc INACTIVE hoặc không có kết quả khớp, **When** xem tổng quan, **Then** các số tổng quan không phụ thuộc bộ lọc đó.
3. **Given** chưa có đơn vị, **When** xem tổng quan, **Then** cả hai số bằng 0.

---

### User Story 3 - Xem chi tiết trường học SA-04 (Priority: P1)

System Admin có quyền phù hợp mở trực tiếp một trường bằng định danh để xem hồ sơ, lớp học, nhà cung cấp liên kết và tài khoản của trường, kể cả khi trường INACTIVE.

**Why this priority**: Trang chi tiết phải truy cập ổn định, đủ dữ liệu quản trị mà không phụ thuộc trang danh sách đã tải hoặc hồ sơ công khai.

**Independent Test**: Mở trực tiếp một trường INACTIVE chưa xuất hiện trong danh sách đã xem; đối chiếu hồ sơ và từng nhóm dữ liệu liên quan bằng quyền tương ứng.

**Acceptance Scenarios**:

1. **Given** trường INACTIVE tồn tại và người xem có quyền, **When** mở trực tiếp chi tiết bằng định danh, **Then** nhận đủ hồ sơ và trạng thái INACTIVE.
2. **Given** trường có lớp, quan hệ nhà cung cấp và tài khoản, **When** người có các quyền tương ứng xem từng nhóm, **Then** chỉ nhận bản ghi của trường được chọn với các trường hiển thị quy định bên dưới.
3. **Given** người xem có quyền hồ sơ nhưng thiếu quyền tài khoản, **When** xem hồ sơ và yêu cầu danh sách tài khoản, **Then** hồ sơ vẫn xem được và yêu cầu tài khoản bị từ chối, không lộ dữ liệu tài khoản.
4. **Given** trường không có dữ liệu liên quan, **When** xem từng nhóm, **Then** nhận danh sách rỗng và tổng số 0.

---

### User Story 4 - Xem chi tiết nhà cung cấp và minh chứng SA-08 (Priority: P1)

System Admin có quyền phù hợp mở nhà cung cấp trực tiếp bằng định danh, xem hồ sơ và chứng nhận của đúng đơn vị, rồi chọn từng tệp minh chứng để xem hoặc tải.

**Why this priority**: Tránh phụ thuộc thứ tự/trang danh sách và hoàn thành thao tác kiểm tra chứng nhận trong hồ sơ quản trị.

**Independent Test**: Mở một nhà cung cấp INACTIVE bằng định danh; xác minh danh sách chứng nhận với nhiều tệp, không tệp, và kiểm tra quyền khi mở từng tệp.

**Acceptance Scenarios**:

1. **Given** nhà cung cấp tồn tại nhưng chưa được tải qua danh sách, **When** mở trực tiếp chi tiết, **Then** nhận đúng hồ sơ, bao gồm cả trường hợp INACTIVE.
2. **Given** nhiều nhà cung cấp có chứng nhận, **When** xem chứng nhận của một đơn vị, **Then** chỉ nhận chứng nhận của đơn vị đó cùng metadata từng tệp minh chứng hiện có.
3. **Given** một chứng nhận có nhiều tệp, **When** chọn từng tệp, **Then** người có quyền có thể xem hoặc tải đúng tệp đã chọn.
4. **Given** chứng nhận không có minh chứng, **When** xem danh sách hoặc yêu cầu mở tệp không tồn tại, **Then** danh sách tệp rỗng và thao tác mở báo không tìm thấy; không tạo liên kết giả.
5. **Given** người xem thiếu quyền chứng nhận hoặc tệp thuộc chứng nhận khác, **When** yêu cầu mở tệp, **Then** không nhận nội dung hay liên kết truy cập tệp.

### Edge Cases

- Từ khóa rỗng hoặc chỉ có khoảng trắng được hiểu là không tìm kiếm; từ khóa khác được bỏ khoảng trắng ở hai đầu và so khớp một phần, không phân biệt hoa/thường, có phân biệt dấu tiếng Việt.
- Từ khóa chứa ký tự như `%` hoặc `_` được hiểu là văn bản cần tìm, không phải ký tự đại diện do người dùng điều khiển.
- Không có kết quả: danh sách rỗng, tổng số 0, không có trang kế tiếp. Trang vượt trang cuối cũng rỗng, giữ tổng số thực và không tự chuyển trang.
- Trường/mã số thuế hoặc thông tin liên hệ null không gây lỗi tìm kiếm hay mất bản ghi khi không có điều kiện tìm kiếm loại trừ nó.
- Trạng thái không hợp lệ, tham số không hỗ trợ, định danh sai định dạng hoặc giá trị phân trang vượt giới hạn bị từ chối với thông báo tiếng Việt theo trường; không lộ dữ liệu đầu vào thô.
- Định danh hợp lệ nhưng không tồn tại hoặc ngoài phạm vi truy cập báo không tìm thấy; thiếu phiên hợp lệ hoặc thiếu quyền được xử lý theo chính sách xác thực hiện hành.
- Khi dữ liệu không thay đổi, chuyển trang theo thứ tự mặc định không lặp hoặc bỏ sót bản ghi. Các lần đọc khác nhau có thể phản ánh cập nhật mới; không yêu cầu giữ ảnh chụp qua nhiều lần chuyển trang.
- Quan hệ nhà cung cấp có thể ACTIVE, SUSPENDED hoặc UNLINKED; trạng thái quan hệ khác với trạng thái của chính nhà cung cấp.
- Chứng nhận hết hạn hoặc INACTIVE vẫn có thể được người có quyền kiểm tra; không tự đổi trạng thái đã lưu chỉ vì đọc dữ liệu.
- Metadata tệp cũ thiếu hoặc không còn xác định được chủ sở hữu thì không tạo quyền truy cập; báo không có tệp khả dụng. Dịch vụ tệp tạm lỗi phải báo lỗi rõ ràng, không công khai hóa tệp để thay thế.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Danh sách trường và nhà cung cấp MUST hỗ trợ tìm kiếm trên toàn bộ phạm vi được phép đọc: tên HOẶC mã trường đối với trường, tên HOẶC mã số thuế đối với nhà cung cấp. Quy tắc chuẩn hóa/so khớp tuân theo Edge Cases; từ khóa sau chuẩn hóa tối đa 255 ký tự.
- **FR-002**: Hai danh sách MUST hỗ trợ lọc đúng một trạng thái ACTIVE hoặc INACTIVE; bỏ lọc thì bao gồm cả hai. Khi có tìm kiếm và trạng thái, bản ghi MUST đồng thời thỏa hai điều kiện.
- **FR-003**: Hệ thống MUST áp dụng phạm vi quyền, tìm kiếm và trạng thái trước khi phân trang; tổng số và các dòng của một kết quả MUST phản ánh cùng tập dữ liệu đã lọc.
- **FR-004**: Phân trang MUST giữ `page`, `limit`, `hasNext` và bổ sung `total` là tổng số bản ghi sau lọc, trước phân trang. Trang mặc định là 1, kích thước mặc định là 20, tối đa 100; chỉ nhận số nguyên dương và giữ giới hạn phân trang hiện hành. `hasNext` chỉ đúng khi còn bản ghi ở sau trang được yêu cầu.
- **FR-005**: Mỗi dòng trường MUST có `id`, `name`, `code`, `status`, `email`, `phone`, `address`, `createdAt`, `updatedAt`; nhà cung cấp dùng `taxCode` thay `code`. Các trường tùy chọn chưa có dữ liệu MUST là null; thông tin liên hệ là của tổ chức, không lấy thay từ tài khoản quản trị.
- **FR-006**: Hai danh sách MUST giữ thứ tự mặc định theo định danh tăng dần khi không có thay đổi dữ liệu. Sắp xếp tùy chọn chưa thuộc phạm vi phiên bản này.
- **FR-007**: Mỗi loại đơn vị MUST có khả năng đọc tổng quan riêng gồm `total` và `activeCount`; tổng số đếm tất cả ACTIVE/INACTIVE, số hoạt động chỉ đếm ACTIVE trong toàn bộ phạm vi được phép xem, độc lập tìm kiếm, trạng thái và phân trang của danh sách.
- **FR-008**: Tổng quan quản trị MUST yêu cầu System Admin có quyền xem loại đơn vị tương ứng; vai trò System Admin tự nó không đủ để đọc dữ liệu.
- **FR-009**: Người có quyền MUST đọc được chi tiết đơn vị bằng định danh ổn định, bao gồm ACTIVE và INACTIVE. Hồ sơ MUST có các trường của FR-005 và thời điểm cập nhật, không cần tải trang danh sách trước.
- **FR-010**: Chi tiết cơ bản MUST dùng phạm vi đọc hiện hành của loại đơn vị. Việc mở dữ liệu quản trị trường INACTIVE MUST không làm mở rộng quyền đọc công khai của trường.
- **FR-011**: Dữ liệu liên quan của trường MUST cho phép đọc từng nhóm độc lập, có phân trang theo FR-004. Chọn trường MUST chỉ thu hẹp phạm vi đã được xác thực, không cấp quyền xem trường khác cho người dùng tổ chức.
- **FR-012**: Mỗi lớp MUST có định danh, định danh trường, tên, năm học, số suất đăng ký và trạng thái. Số suất đăng ký là số đã lưu của lớp, không phải tổng suất ăn của một ngày hay số học sinh suy diễn; năm học chưa có dữ liệu được trả null.
- **FR-013**: Mỗi quan hệ nhà cung cấp của trường MUST có định danh quan hệ, định danh trường/nhà cung cấp, tên nhà cung cấp, trạng thái nhà cung cấp, trạng thái quan hệ và ngày liên kết. Mặc định bao gồm mọi trạng thái quan hệ đã lưu, kể cả UNLINKED; không gộp các lần liên kết khác nhau thành một dòng.
- **FR-014**: Mỗi tài khoản thuộc trường MUST có định danh, họ tên, email, mã và nhãn vai trò, trạng thái. Danh sách bao gồm mọi trạng thái tài khoản đang gắn với trường; không trả tài khoản chưa gắn trường hoặc thuộc trường khác.
- **FR-015**: Danh sách chứng nhận MUST cho phép chọn một nhà cung cấp và chỉ trả chứng nhận trong phạm vi được phép của đơn vị đó, có phân trang theo FR-004. Mỗi mục MUST có định danh chứng nhận/nhà cung cấp, loại, số chứng nhận, ngày cấp, ngày hết hạn, trạng thái và các thời điểm tạo/cập nhật đã có.
- **FR-016**: Mỗi chứng nhận MUST có danh sách minh chứng hiện có, hỗ trợ nhiều tệp. Metadata an toàn gồm định danh tệp, tên tệp, định dạng và kích thước; không có tệp thì trả mảng rỗng. Ngày cấp/hết hạn chưa có dữ liệu MUST là null.
- **FR-017**: Thao tác xem/tải MUST chọn đúng chứng nhận và tệp, xác minh lại quyền và quan hệ tệp với chứng nhận/nhà cung cấp trước khi cấp quyền truy cập có thời hạn. Thời hạn truy cập là 60 giây theo quy ước tệp hiện có; người xem có thể yêu cầu lại khi hết hạn.
- **FR-018**: Nội dung minh chứng MUST được giữ riêng tư; danh sách/chi tiết không trả bí mật lưu trữ hoặc liên kết công khai lâu dài. Đường dẫn cũ không đủ bằng chứng liên kết tệp với chứng nhận MUST không được dùng để bỏ qua kiểm tra quyền.
- **FR-019**: Danh sách, chi tiết và tổng quan trường MUST kiểm tra quyền đọc trường hiện hành (`school.manage`); nhà cung cấp MUST kiểm tra một trong `supplier.view`, `supplier.manage`. Quyền và phạm vi tổ chức hiện hành MUST tiếp tục áp dụng cho người dùng ngoài System Admin.
- **FR-020**: Các nhóm lớp, quan hệ, tài khoản và chứng nhận/tệp MUST kiểm tra quyền riêng hiện hành tương ứng: `class.view`; một trong `supplier_relationship.view`, `supplier_relationship.manage`; quyền quản lý tài khoản phù hợp phạm vi; `supplier_certification.view`. Đối với System Admin, nhóm tài khoản yêu cầu `user.manage`; ngoài SYSTEM giữ chính sách quản lý tài khoản theo tổ chức hiện hành. Quyền xem hồ sơ cơ bản MUST không thay thế các quyền này; không lộ nhóm bị cấm qua hồ sơ tổng hợp.
- **FR-021**: Tất cả thao tác đọc MUST sử dụng quyền hiệu lực và tổ chức hiện tại của người dùng; bộ chọn định danh trường/nhà cung cấp chỉ là điều kiện thu hẹp. Ngoài SYSTEM, trường/nhà cung cấp chỉ đọc dữ liệu trong phạm vi sở hữu hoặc quan hệ được chính sách hiện hành cho phép.
- **FR-022**: Dữ liệu trả về MUST giữ cấu trúc thành công/lỗi hiện hành, bảo toàn trường đầu ra hiện có và biểu diễn thời điểm theo ISO 8601. Thông tin nhạy cảm như mật khẩu, token, bí mật lưu trữ và dữ liệu quyền nội bộ MUST không xuất hiện trong các kết quả này.
- **FR-023**: Sai dữ liệu đầu vào MUST báo 400; thiếu/sai phiên 401; thiếu quyền hoặc tài khoản không đủ điều kiện 403; tài nguyên không tồn tại/ngoài phạm vi 404; nguồn dữ liệu hoặc tệp tạm không khả dụng 503. Lỗi MUST có thông báo tiếng Việt và không lộ lỗi truy vấn hay bí mật hệ thống.

### Key Entities _(include if feature involves data)_

- **Trường học**: Đơn vị có tên, mã có thể chưa có, thông tin liên hệ, trạng thái và thời điểm tạo/cập nhật; sở hữu lớp và tài khoản.
- **Nhà cung cấp**: Đơn vị có tên, mã số thuế có thể chưa có, thông tin liên hệ, trạng thái và thời điểm tạo/cập nhật; sở hữu chứng nhận.
- **Lớp học**: Thuộc một trường; có tên, năm học, số suất đăng ký và trạng thái.
- **Quan hệ trường – nhà cung cấp**: Một lần liên kết giữa hai đơn vị, có trạng thái riêng và ngày liên kết.
- **Tài khoản trường**: Tài khoản hiện gắn với trường, có thông tin hiển thị, một vai trò và trạng thái; độc lập với thông tin liên hệ tổ chức.
- **Chứng nhận và minh chứng**: Chứng nhận thuộc nhà cung cấp, có loại/số/ngày/trạng thái; mỗi chứng nhận có thể có nhiều tệp riêng tư đã được liên kết với nó.
- **Kết quả danh sách và tổng quan**: Tổng sau lọc phục vụ phân trang; tổng toàn phạm vi và số ACTIVE phục vụ tổng quan, có ý nghĩa tách biệt.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Với 100 đơn vị mỗi loại, 100% bản ghi khớp tìm kiếm/lọc được tìm thấy khi duyệt hết kết quả, bao gồm bản ghi ngoài 5 dòng đầu; không có bản ghi không khớp trong kết quả.
- **SC-002**: Khi dữ liệu không đổi, duyệt hết kết quả với kích thước trang 5 và 20 cho cùng tập bản ghi, không trùng/thiếu; tổng số và dấu hiệu trang tiếp theo chính xác ở mọi trang, kể cả trang rỗng.
- **SC-003**: Trong toàn bộ kịch bản thay đổi tìm kiếm, trạng thái và trang, hai số tổng quan vẫn đúng với dữ liệu toàn phạm vi; dữ liệu trống cho kết quả 0/0.
- **SC-004**: 100% đơn vị ACTIVE và INACTIVE trong bộ kiểm thử mà người xem có quyền đều mở được chi tiết bằng định danh khi chưa tải danh sách trước đó; các nhóm liên quan có đủ trường hiển thị yêu cầu.
- **SC-005**: Trong toàn bộ kịch bản thiếu quyền, ngoài phạm vi và giả mạo định danh tệp, không có hồ sơ, dữ liệu liên quan hoặc nội dung/liên kết minh chứng bị lộ.
- **SC-006**: Người kiểm thử có đủ quyền hoàn thành được luồng chọn trường, xem ba nhóm liên quan; chọn nhà cung cấp, xem chứng nhận và mở từng minh chứng, chỉ dựa trên dữ liệu được cung cấp, không cần ghép thông tin từ danh sách đã tải hoặc hồ sơ công khai.

## Assumptions

- Phạm vi là cung cấp dữ liệu đọc cho các màn quản trị; việc cập nhật giao diện/service frontend và chuyển bộ lọc frontend sang dữ liệu mới là công việc tích hợp sau.
- Các đường dẫn và cách chia kết quả trong đề xuất đầu vào là gợi ý; hợp đồng cụ thể sẽ được ghi trong bước lập kế hoạch, bảo đảm đủ hành vi và quyền riêng nêu trên.
- Chọn chưa hỗ trợ sắp xếp tùy chọn vì đầu vào đặt phần này là tùy chọn và chưa chỉ định trường sắp xếp. Bộ lọc năm học của lớp và bộ lọc trạng thái quan hệ không thuộc yêu cầu lần này.
- Thống kê hoạt động riêng ở SA-08 chưa thuộc phạm vi vì chưa có định nghĩa chỉ số và nguồn dữ liệu; chỉ hai số tổng quan đơn vị được xác định trong FR-007.
- Dùng dữ liệu đã lưu và cơ chế tệp riêng tư hiện có theo [ONBOARDING.md](../../docs/ONBOARDING.md), bao gồm nhiều tệp của một chứng nhận; không tạo metadata, ngày cấp, thời hạn hay tệp giả cho dữ liệu cũ.
- Các trường mở rộng hồ sơ ngoài danh sách cụ thể trong FR-005/FR-009 chưa được xác định bởi thiết kế nên chưa nằm trong phạm vi. Địa chỉ quản trị là địa chỉ tổ chức đã lưu, không ghép thêm địa danh mặc định.
- Chính sách quyền kế thừa từ [AUTHORIZATION.md](../../docs/AUTHORIZATION.md). Người đọc dữ liệu liên quan cần quyền riêng của từng nhóm; không thêm vai trò hay cấp quyền tự động để hoàn thành màn hình.
- Không bao gồm tạo/sửa/xóa đơn vị, đổi trạng thái, tạo tài khoản, liên kết mới, cấp chứng nhận, upload tệp mới, thay đổi cấu trúc lưu trữ hoặc chạy thay đổi dữ liệu. Phụ thuộc dữ liệu tổ chức, quan hệ và metadata minh chứng đang tồn tại.
