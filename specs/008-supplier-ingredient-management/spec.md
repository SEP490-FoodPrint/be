# Feature Specification: Quản lý nguyên liệu của nhà cung cấp

**Feature Branch**: `feat/008-supplier-ingredient-management`

**Created**: 2026-11-08

**Status**: Implemented — đã kiểm chứng trên hạ tầng local tạm

**Input**: User description: "Thêm chức năng thêm/sửa/ẩn nguyên liệu của chính nhà cung cấp mà Ingredient Supplier Admin đại diện đăng ký; staff không được truy cập. Thêm coverImage chứa một ảnh, imageDescription chứa nhiều ảnh. Thay category bằng categoryId liên kết ingredientCategory có đúng id, categoryName, categoryDescription. Danh mục thuộc trách nhiệm System Admin nhưng chưa triển khai chức năng quản lý danh mục."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Thêm nguyên liệu thuộc nhà cung cấp của mình (Priority: P1)

Quản trị nhà cung cấp nguyên liệu đăng ký nguyên liệu của tổ chức mình, kèm thông tin mô tả, phân loại và ảnh để có danh sách nguyên liệu cung ứng chính xác.

**Why this priority**: Đây là thao tác cốt lõi tạo nguyên liệu, đồng thời phải bảo đảm không đăng ký thay nhà cung cấp khác.

**Independent Test**: Dùng quản trị của nhà cung cấp A để tạo một nguyên liệu hợp lệ rồi kiểm tra thông tin đã lưu và chủ sở hữu; dùng staff và quản trị B để kiểm tra giới hạn truy cập.

**Acceptance Scenarios**:

1. **Given** quản trị A đang hoạt động và có quyền quản lý nguyên liệu hiệu lực, **When** thêm nguyên liệu có tên và đơn vị hợp lệ, **Then** nguyên liệu được tạo ở trạng thái đang hoạt động và tự thuộc nhà cung cấp A.
2. **Given** đã có danh mục dùng chung, **When** quản trị A chọn danh mục và lưu một ảnh bìa cùng ba ảnh mô tả, **Then** nguyên liệu giữ đúng danh mục, một ảnh bìa và đủ ba ảnh mô tả theo thứ tự đã gửi.
3. **Given** staff của A, kể cả khi được gán quyền quản lý nguyên liệu, **When** truy cập chức năng quản lý hoặc gửi yêu cầu thêm nguyên liệu, **Then** bị từ chối và không phát sinh nguyên liệu.
4. **Given** quản trị A, **When** cố chỉ định nhà cung cấp B làm chủ sở hữu, **Then** yêu cầu bị từ chối và không tạo nguyên liệu cho B.
5. **Given** nguyên liệu cùng tên đã tồn tại ở A, kể cả đang ẩn, **When** tạo thêm tên đó, **Then** được báo lỗi trùng tên; tên đó ở nhà cung cấp B không gây lỗi trùng cho A.

---

### User Story 2 - Xem và sửa nguyên liệu thuộc sở hữu (Priority: P1)

Quản trị xem danh sách và chi tiết nguyên liệu của mình, chỉnh sửa thông tin, danh mục hoặc ảnh mà không chuyển quyền sở hữu.

**Why this priority**: Danh sách quản trị và chi tiết giúp chọn đúng nguyên liệu; dữ liệu cần cập nhật trong quá trình cung ứng.

**Independent Test**: Chuẩn bị nguyên liệu của A và B; xác minh quản trị A xem và sửa được nguyên liệu A, không xem hay sửa được nguyên liệu B trong chức năng này.

**Acceptance Scenarios**:

1. **Given** A có nguyên liệu đang hoạt động và đang ẩn, **When** quản trị A mở danh sách quản trị, **Then** chỉ thấy nguyên liệu A, có phân trang và trạng thái để phân biệt nguyên liệu đang ẩn.
2. **Given** nguyên liệu thuộc A, **When** sửa tên, đơn vị, mô tả, danh mục hoặc thay ảnh, **Then** thông tin hợp lệ được lưu và có thể đọc lại; thông tin không gửi sửa được giữ nguyên.
3. **Given** nguyên liệu thuộc B hoặc mã nguyên liệu không tồn tại, **When** quản trị A yêu cầu chi tiết, sửa hoặc ẩn, **Then** nhận cùng loại kết quả không tìm thấy và không nhận thông tin riêng của B.
4. **Given** danh mục không tồn tại hoặc tên sửa trùng tên nguyên liệu khác của A, **When** lưu thay đổi, **Then** toàn bộ lần sửa bị từ chối và dữ liệu cũ được giữ nguyên.
5. **Given** quyền quản lý đã bị thu hồi hoặc tài khoản không còn hoạt động, **When** tiếp tục thao tác bằng phiên đăng nhập trước đó, **Then** không được xem hoặc thay đổi dữ liệu quản trị.

---

### User Story 3 - Ẩn nguyên liệu và bảo toàn lịch sử (Priority: P2)

Quản trị ẩn nguyên liệu không còn muốn cung ứng để ngừng xuất hiện trong lựa chọn nguyên liệu mới, đồng thời bảo toàn các hồ sơ đã sử dụng nguyên liệu đó.

**Why this priority**: Ngừng cung ứng phải giữ được lịch sử thực đơn, kho, hợp đồng và truy xuất nguồn gốc.

**Independent Test**: Ẩn một nguyên liệu A có liên kết nghiệp vụ; kiểm tra danh sách quản trị, danh sách lựa chọn mới và các liên kết lịch sử.

**Acceptance Scenarios**:

1. **Given** nguyên liệu A đang hoạt động, **When** quản trị A ẩn nguyên liệu, **Then** nguyên liệu chuyển sang không hoạt động, vẫn xuất hiện với trạng thái ẩn trong quản trị và không xuất hiện trong danh sách chọn nguyên liệu mới.
2. **Given** nguyên liệu đã ẩn, **When** yêu cầu ẩn lại, **Then** trạng thái vẫn ẩn, không báo lỗi chỉ vì thao tác đã hoàn tất.
3. **Given** nguyên liệu đã được dùng trong hồ sơ nghiệp vụ, **When** ẩn nguyên liệu, **Then** các hồ sơ và liên kết hiện có được giữ nguyên, không tự hủy hoặc sửa giao dịch đang có.
4. **Given** nguyên liệu đang ẩn của A, **When** quản trị A sửa mô tả hoặc ảnh, **Then** dữ liệu được sửa và trạng thái vẫn ẩn.

### Edge Cases

- Chưa đăng nhập: không được truy cập; vai trò khác, kể cả System Admin, không có quyền truy cập ngầm chức năng quản trị nguyên liệu nhà cung cấp.
- Tài khoản thiếu tổ chức nhà cung cấp hợp lệ hoặc tổ chức không hoạt động: từ chối thao tác quản trị.
- Danh mục rỗng: trả danh sách trống; theo giả định giữ tính tùy chọn hiện tại, vẫn có thể lưu nguyên liệu chưa phân loại.
- Gửi nhiều ảnh vào `coverImage`, ảnh sai định dạng tham chiếu hoặc thuộc tính không được chấp nhận: từ chối toàn bộ yêu cầu với lỗi tiếng Việt chỉ rõ trường.
- Khi sửa, không gửi trường ảnh nghĩa là giữ nguyên; gửi `coverImage` rỗng theo giá trị xóa được chấp nhận nghĩa là bỏ ảnh bìa; gửi danh sách `imageDescription` rỗng nghĩa là xóa toàn bộ ảnh mô tả.
- Hai lần tạo/sửa đồng thời cùng tên ở cùng nhà cung cấp: không tạo hai nguyên liệu trùng tên, thao tác xung đột nhận lỗi phù hợp.
- Danh mục cũ chưa có hoặc có giá trị rỗng: không tạo danh mục giả; thông tin phân loại có ý nghĩa phải được bảo toàn khi chuyển đổi.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Chỉ tài khoản đang hoạt động có vai trò `INGREDIENT_SUPPLIER_ADMIN`, tổ chức nhà cung cấp đang hoạt động và quyền `ingredient.manage` hiệu lực được truy cập danh sách quản trị, chi tiết, thêm, sửa và ẩn thuộc chức năng này. `INGREDIENT_SUPPLIER_STAFF` bị chặn kể cả khi có quyền đó; vai trò khác không được truy cập chức năng này.
- **FR-002**: Mỗi thao tác phải xác định nhà cung cấp từ danh tính và quan hệ tổ chức hiện tại đã được xác thực, không từ mã nhà cung cấp do người dùng nhập. Không cho phép chuyển nguyên liệu sang nhà cung cấp khác.
- **FR-003**: Cho phép thêm nguyên liệu với tên và đơn vị mặc định bắt buộc; mô tả, danh mục và ảnh tùy chọn. Nguyên liệu mới mặc định đang hoạt động. Giữ giới hạn hiện có: tên tối đa 255 ký tự, đơn vị tối đa 30 ký tự, không chấp nhận tên/đơn vị chỉ gồm khoảng trắng.
- **FR-004**: Tên nguyên liệu phải duy nhất trong cùng nhà cung cấp theo quy tắc so sánh tên hiện hành, bao gồm nguyên liệu đang ẩn; không áp đặt tên duy nhất toàn hệ thống.
- **FR-005**: Cho phép xem danh sách có phân trang và chi tiết nguyên liệu thuộc nhà cung cấp hiện tại, gồm thông tin mô tả, danh mục, ảnh và trạng thái; danh sách quản trị bao gồm cả nguyên liệu đang ẩn. Giữ các quyền đọc nghiệp vụ hiện có ngoài chức năng quản trị này.
- **FR-006**: Cho phép sửa tên, đơn vị mặc định, mô tả, danh mục, ảnh bìa và ảnh mô tả của nguyên liệu thuộc sở hữu. Không gửi một trường khi sửa nghĩa là giữ nguyên; sửa không được thay đổi định danh, chủ sở hữu hoặc tự bật lại nguyên liệu.
- **FR-007**: `coverImage` biểu diễn tối đa một ảnh bìa; `imageDescription` biểu diễn danh sách không hoặc nhiều ảnh mô tả, giữ thứ tự. Hai thuộc tính có mục đích riêng và không thay thế mô tả văn bản hiện có. Cho phép thay hoặc bỏ ảnh bìa, thay hoặc xóa danh sách ảnh mô tả.
- **FR-008**: Thay thông tin `category` dạng nhập tự do bằng quan hệ `categoryId` tới danh mục `ingredientCategory` dùng chung. Mỗi nguyên liệu có tối đa một danh mục; mỗi danh mục dùng cho nhiều nguyên liệu. Mã danh mục được chọn phải tồn tại; không lưu song song hai nguồn phân loại độc lập.
- **FR-009**: Danh mục có đúng ba thuộc tính nghiệp vụ `id`, `categoryName`, `categoryDescription`: định danh duy nhất, tên bắt buộc không rỗng và mô tả tùy chọn. Không bổ sung trạng thái, chủ sở hữu hay thuộc tính thời gian vào danh mục trong phạm vi này.
- **FR-010**: Cung cấp danh sách danh mục có sẵn chỉ đọc cho quản trị nhà cung cấp đủ điều kiện lựa chọn. Danh mục thuộc trách nhiệm quản lý của System Admin; không xây dựng thao tác thêm/sửa/xóa danh mục cho bất kỳ vai trò nào trong tính năng này.
- **FR-011**: Ẩn bằng trạng thái không hoạt động hiện có, không xóa nguyên liệu. Giữ nguyên mọi liên kết lịch sử; loại khỏi danh sách lựa chọn nguyên liệu mới. Không tự động hủy hoặc thay đổi nghiệp vụ đã ghi nhận.
- **FR-012**: Khi truy cập mã nguyên liệu ngoài sở hữu, xử lý như không tìm thấy; không tiết lộ sự tồn tại, thông tin hoặc ảnh của nhà cung cấp khác.
- **FR-013**: Dữ liệu không hợp lệ phải được từ chối trọn vẹn, báo các lỗi bằng tiếng Việt kèm trường liên quan và không làm mất dữ liệu đã lưu. Định dạng phản hồi, phân trang và việc chỉ cung cấp thông tin được phép phải nhất quán với hệ thống hiện hành.
- **FR-014**: Chuyển đổi phân loại cũ phải giữ định danh nguyên liệu, chủ sở hữu, liên kết nghiệp vụ và thông tin phân loại đang có; các giá trị danh mục giống nhau được dùng chung thay vì tạo một danh mục cho mỗi nguyên liệu. Không tạo danh mục mẫu hoặc dữ liệu kinh doanh mẫu.

### Key Entities

- **Nguyên liệu (`Ingredient`)**: Nguyên liệu do một nhà cung cấp sở hữu; có định danh, tên, đơn vị mặc định, mô tả, trạng thái và thời điểm ghi nhận hiện có; bổ sung một ảnh bìa `coverImage`, danh sách ảnh mô tả `imageDescription`, và tham chiếu danh mục `categoryId` thay cho `category`.
- **Danh mục nguyên liệu (`ingredientCategory`)**: Phân loại dùng chung do System Admin chịu trách nhiệm, gồm đúng `id`, `categoryName`, `categoryDescription`; tính năng này chỉ đọc để chọn.
- **Nhà cung cấp và tài khoản quản trị**: Quan hệ hiện hành xác định phạm vi sở hữu của người thao tác; staff cùng nhà cung cấp không có quyền quản trị nguyên liệu.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% kịch bản hợp lệ thêm, xem, sửa và ẩn nguyên liệu của chính nhà cung cấp hoàn thành với dữ liệu đọc lại khớp thông tin đã lưu.
- **SC-002**: 100% kịch bản staff, vai trò không được phép, quyền bị thu hồi và truy cập chéo nhà cung cấp bị chặn; không làm thay đổi hoặc tiết lộ dữ liệu của tổ chức khác.
- **SC-003**: Lưu và đọc lại thành công một ảnh bìa cùng ít nhất ba ảnh mô tả; mọi trường hợp gửi nhiều ảnh bìa đều bị từ chối, mọi ảnh mô tả hợp lệ giữ đúng thứ tự.
- **SC-004**: 100% nguyên liệu được ẩn không còn trong lựa chọn nguyên liệu mới, vẫn có trong quản trị của chủ sở hữu và giữ đủ liên kết hồ sơ nghiệp vụ trước khi ẩn.
- **SC-005**: 100% nguyên liệu hiện có giữ nguyên định danh và liên kết nghiệp vụ sau chuyển đổi danh mục; không mất giá trị phân loại có ý nghĩa.

## Assumptions

- Đặc tả áp dụng cho backend hiện có. Triển khai và migration được kiểm chứng trên database tạm; việc deploy database đang sử dụng tuân theo quy trình riêng.
- Ảnh và danh mục được giả định là tùy chọn để giữ khả năng sử dụng dữ liệu cũ. `coverImage` không có ảnh được biểu diễn bằng giá trị rỗng phù hợp; `imageDescription` mặc định là danh sách rỗng; `categoryId` có thể chưa được chọn, tương ứng `category` đang tùy chọn.
- Giả định ảnh được cung cấp bằng tham chiếu ảnh đã có, chẳng hạn đường dẫn hoặc địa chỉ ảnh; xây dựng dịch vụ tải tệp, lưu trữ ảnh và xóa tệp vật lý nằm ngoài phạm vi. Định dạng tham chiếu và giới hạn kích thước yêu cầu sẽ được cụ thể hóa trong bước lập kế hoạch.
- Danh mục có sẵn là dữ liệu đầu vào phụ thuộc. Việc chuyển các giá trị phân loại thật đang tồn tại thành danh mục tương ứng phục vụ bảo toàn dữ liệu; không đồng nghĩa với cấp quyền tạo dữ liệu mẫu hoặc triển khai bộ quản lý danh mục.
- Phạm vi chỉ gồm thêm/sửa/ẩn và các lần đọc cần để quản trị; chưa có xóa vĩnh viễn hoặc khôi phục hiển thị. Ẩn không cấm đọc hồ sơ lịch sử theo quyền đã có.
- Quy tắc tên trùng giữ nguyên hiện hành; không tự thêm quy tắc không phân biệt dấu hoặc chữ hoa/chữ thường. Nếu cần thay đổi quy tắc đó, phải bổ sung yêu cầu trước khi triển khai.
