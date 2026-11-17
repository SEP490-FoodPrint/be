# Feature Specification: Quản lí nhân viên nhà cung cấp nguyên liệu

**Feature Branch**: `feat/supplier-staff-management`

**Created**: 2026-11-16

**Status**: Backend implemented — năm luồng/bảy API và email-only mọi vai trò đã kiểm chứng local ngày 2026-11-17. SC-006 chờ nghiệm thu qua ứng dụng; chưa deploy database thành viên/Azure.

**Input**: User description: "Là ingredient supplier admin tôi muốn có tính năng quản lí nhân viên, bao gồm: xem danh sách, xem chi tiết, khóa/mở tài khoản của nhân viên, tạo tài khoản cho nhân viên, quản lí quyền truy cập của nhân viên."

## Clarifications

### Session 2026-11-16

- Q: Nhân viên thuộc hai nhà cung cấp khác nhau có được dùng cùng tên đăng nhập không? → A: Có. Theo yêu cầu người dùng, tài khoản nhân viên giữa các nhà cung cấp độc lập; tên đăng nhập chỉ cần không trùng trong cùng nhà cung cấp. Tên đăng nhập giống nhau không có nghĩa hai tài khoản dùng chung danh tính, mật khẩu, trạng thái hoặc quyền.

- Q: Bạn có muốn cho phép hai staff thuộc hai nhà cung cấp khác nhau trùng cả email không? → A: Theo điều chỉnh mới nhất của người dùng, không. Username được trùng giữa các nhà cung cấp và chỉ cần duy nhất trong cùng nhà cung cấp; email phải duy nhất toàn hệ thống, không phân biệt chữ hoa/thường. Quyết định này thay thế lựa chọn A trước đó.

- Q: Bạn muốn staff đăng nhập theo cách nào? → A: Chọn A. Staff chỉ đăng nhập bằng email duy nhất toàn hệ thống và mật khẩu; không đăng nhập bằng username, không cần mã hoặc link nhà cung cấp riêng.

### Session 2026-11-17

- Q: Bạn muốn áp dụng cách đăng nhập nào cho toàn bộ các vai trò? → A: Chọn A. Tất cả vai trò chỉ đăng nhập bằng email duy nhất toàn hệ thống và mật khẩu. Username vẫn được lưu theo các quy tắc đã chốt nhưng không dùng đăng nhập; không còn tra cứu đồng thời username hoặc email. Quyết định này thay thế giới hạn email-only riêng cho supplier staff và yêu cầu giữ username-login của các vai trò khác trong thiết kế trước.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Xem danh sách nhân viên (Priority: P1)

Là quản trị viên nhà cung cấp nguyên liệu, tôi muốn xem danh sách nhân viên của nhà cung cấp mình để biết ai đang có tài khoản và trạng thái truy cập của họ.

**Why this priority**: Đây là điểm bắt đầu để chọn đúng nhân viên cần quản lí.

**Independent Test**: Chuẩn bị hai nhà cung cấp, mỗi bên có quản trị viên và nhân viên ở nhiều trạng thái; kiểm tra danh sách bằng quản trị viên từng bên.

**Acceptance Scenarios**:

1. **Given** quản trị viên đang hoạt động và có quyền quản lí nhân viên, **When** xem danh sách, **Then** chỉ thấy tài khoản mang vai trò nhân viên nhà cung cấp nguyên liệu thuộc nhà cung cấp hiện tại, gồm cả tài khoản không hoạt động; không thấy quản trị viên hoặc tài khoản ngoài phạm vi.
2. **Given** danh sách có nhiều nhân viên, **When** chuyển trang, **Then** nhận đúng trang, thông tin phân trang và thứ tự ổn định khi dữ liệu không đổi.
3. **Given** chưa có nhân viên hoặc trang vượt dữ liệu hiện có, **When** xem danh sách, **Then** nhận danh sách rỗng cùng thông tin phân trang hợp lệ.
4. **Given** người thực hiện thiếu quyền quản lí nhân viên hoặc không phải quản trị viên nhà cung cấp, **When** xem danh sách, **Then** bị từ chối, kể cả khi mang vai trò quản trị khác.

---

### User Story 2 - Xem chi tiết nhân viên (Priority: P1)

Là quản trị viên nhà cung cấp nguyên liệu, tôi muốn xem thông tin một nhân viên để xác định đúng tài khoản trước khi thay đổi trạng thái hoặc quyền truy cập.

**Why this priority**: Giúp tránh thao tác nhầm tài khoản và kiểm tra kết quả quản lí.

**Independent Test**: Chọn nhân viên sẵn có, kiểm tra chi tiết khi tài khoản hoạt động và khi bị khóa mà không cần tạo mới hoặc sửa quyền.

**Acceptance Scenarios**:

1. **Given** nhân viên thuộc nhà cung cấp hiện tại, **When** xem chi tiết, **Then** thấy định danh tài khoản, tên đăng nhập, họ tên, email, số điện thoại nếu có, vai trò, trạng thái, thời điểm tạo và cập nhật; không thấy mật khẩu hay thông tin bí mật.
2. **Given** nhân viên bị khóa hoặc mang trạng thái không hoạt động khác, **When** xem chi tiết, **Then** vẫn xem được thông tin và trạng thái thực tế theo cùng phạm vi phân quyền.
3. **Given** định danh không tồn tại, thuộc nhà cung cấp khác hoặc là tài khoản quản trị viên, **When** xem chi tiết qua chức năng này, **Then** nhận cùng thông báo không tìm thấy tài khoản nhân viên, không tiết lộ thông tin ngoài phạm vi.

---

### User Story 3 - Tạo tài khoản nhân viên (Priority: P1)

Là quản trị viên nhà cung cấp nguyên liệu, tôi muốn tạo tài khoản cho nhân viên mới để họ làm việc theo quyền nhân viên trong nhà cung cấp mình.

**Why this priority**: Cho phép tiếp nhận nhân sự mới mà không cần nhờ quản trị viên hệ thống tạo từng tài khoản.

**Independent Test**: Tạo tài khoản bằng thông tin hợp lệ, đăng nhập bằng email và mật khẩu khởi tạo, kiểm tra vai trò, tổ chức, quyền ban đầu. Kiểm tra hồi quy đăng nhập email-only cho mọi vai trò: username không dùng để tìm tài khoản, kể cả khi username trùng email của người khác.

**Acceptance Scenarios**:

1. **Given** quản trị viên đủ quyền và thông tin hợp lệ, **When** tạo tài khoản với tên đăng nhập, họ tên, email, mật khẩu khởi tạo và số điện thoại tùy chọn, **Then** tạo đúng một tài khoản hoạt động, tự gắn nhà cung cấp hiện tại và vai trò `INGREDIENT_SUPPLIER_STAFF`, kế thừa các quyền đang hoạt động của vai trò đó.
2. **Given** tên đăng nhập trùng tài khoản trong cùng nhà cung cấp hoặc email trùng bất kỳ tài khoản nào trong hệ thống, kể cả tài khoản đã khóa/vô hiệu hóa, **When** tạo tài khoản, **Then** từ chối vì thông tin đó đã được sử dụng trong phạm vi kiểm tra tương ứng, không tạo tài khoản một phần và không tiết lộ tài khoản ngoài phạm vi.
3. **Given** thiếu trường bắt buộc, dữ liệu sai hoặc cố chỉ định tổ chức/vai trò khác, **When** tạo tài khoản, **Then** từ chối với thông báo tiếng Việt chỉ ra các trường không hợp lệ; không thay đổi dữ liệu.
4. **Given** tài khoản đã tạo thành công, **When** nhân viên đăng nhập bằng email và mật khẩu hợp lệ, **Then** được xác định đúng tài khoản và nhà cung cấp với quyền nhân viên, không cần mã/link nhà cung cấp và không phải đăng ký hoặc nộp hồ sơ tổ chức mới; email được chuẩn hóa không phân biệt chữ hoa/thường, không phụ thuộc username trùng ở nhà cung cấp khác.
5. **Given** nhà cung cấp A và B độc lập, mỗi bên có quản trị viên đủ quyền, **When** cả hai tạo nhân viên cùng tên đăng nhập nhưng email khác nhau chưa được sử dụng, với các trường khác hợp lệ, **Then** cả hai được tạo thành công thành hai tài khoản riêng; khóa/mở khóa hoặc thay quyền một tài khoản không ảnh hưởng tài khoản còn lại.
6. **Given** một email đã thuộc tài khoản nhà cung cấp A, **When** quản trị viên nhà cung cấp B tạo nhân viên với email đó, kể cả chỉ khác chữ hoa/thường, **Then** từ chối vì email đã được sử dụng mà không tiết lộ danh tính hoặc tổ chức của tài khoản đã có.

7. **Given** tài khoản có username riêng không trùng email nào trong hệ thống và đúng mật khẩu, **When** dùng username thay email để đăng nhập, **Then** bị từ chối xác thực và không cấp phiên, kể cả username đó duy nhất; quy tắc áp dụng mọi vai trò.
8. **Given** tài khoản thuộc bất kỳ vai trò nào đủ điều kiện đăng nhập theo trạng thái và xác minh hiện hành, **When** nhập email và mật khẩu hợp lệ, **Then** được xác thực đúng tài khoản bằng email, không cần username hoặc chọn tổ chức; các điều kiện trạng thái/onboarding và quyền sau đăng nhập không đổi.
9. **Given** email của một tài khoản đồng thời là username của tài khoản khác, **When** đăng nhập bằng email đó, **Then** chỉ xét tài khoản sở hữu email và kiểm tra mật khẩu của tài khoản đó; username trùng không gây lỗi nhiều tài khoản hoặc chọn nhầm người; nếu mật khẩu chỉ đúng với chủ username nhưng không đúng với chủ email thì phải từ chối đăng nhập, không thử sang tài khoản chủ username.

---

### User Story 4 - Khóa và mở khóa tài khoản nhân viên (Priority: P1)

Là quản trị viên nhà cung cấp nguyên liệu, tôi muốn khóa hoặc mở khóa từng nhân viên để thu hồi hoặc khôi phục khả năng truy cập khi cần.

**Why this priority**: Kiểm soát việc sử dụng tài khoản kịp thời và bảo toàn lịch sử công việc.

**Independent Test**: Dùng nhân viên có phiên đăng nhập sẵn; khóa tài khoản, kiểm tra truy cập rồi mở khóa và đăng nhập lại.

**Acceptance Scenarios**:

1. **Given** nhân viên đang `ACTIVE`, **When** quản trị viên khóa tài khoản, **Then** tài khoản chuyển `LOCKED`; lần đăng nhập, gia hạn phiên và yêu cầu nghiệp vụ tiếp theo đều bị từ chối, kể cả dùng phiên đã có.
2. **Given** nhân viên đang `LOCKED`, **When** quản trị viên mở khóa, **Then** tài khoản chuyển `ACTIVE` và có thể đăng nhập lại; các quyền đã bị tắt riêng trước đó vẫn bị tắt.
3. **Given** trạng thái hiện tại đã đúng trạng thái mong muốn, **When** lặp thao tác khóa hoặc mở khóa hợp lệ, **Then** trả kết quả nhất quán, không tạo thêm tác động nghiệp vụ.
4. **Given** tài khoản là `UNVERIFIED`, `INACTIVE` hoặc `DEACTIVATED`, **When** dùng chức năng khóa/mở khóa này, **Then** bị từ chối vì trạng thái không hỗ trợ; không dùng mở khóa để kích hoạt lại tài khoản bị vô hiệu hóa.
5. **Given** còn công việc gắn với nhân viên, **When** khóa tài khoản, **Then** chỉ thay đổi khả năng truy cập của nhân viên; không tự hủy, hoàn tất, chuyển người phụ trách hoặc xóa lịch sử công việc.

---

### User Story 5 - Quản lí quyền truy cập riêng của nhân viên (Priority: P1)

Là quản trị viên nhà cung cấp nguyên liệu, tôi muốn xem và bật/tắt quyền riêng của một nhân viên để giới hạn nhiệm vụ của họ trong bộ quyền nhân viên được hệ thống cho phép.

**Why this priority**: Cho phép phân công quyền truy cập theo người và giữ giới hạn quyền của vai trò nhân viên.

**Independent Test**: Với hai nhân viên đang hoạt động có cùng vai trò, tắt rồi bật lại một quyền của người thứ nhất; kiểm tra truy cập của cả hai.

**Acceptance Scenarios**:

1. **Given** nhân viên đang hoạt động, **When** xem quyền truy cập, **Then** thấy các quyền thuộc vai trò nhân viên, tên/mô tả quyền, trạng thái hoạt động của quyền và trạng thái hiệu lực trên tài khoản đó.
2. **Given** một quyền đang hoạt động thuộc vai trò nhân viên, **When** tắt quyền cho một nhân viên, **Then** quyền đó không còn hiệu lực từ yêu cầu nghiệp vụ tiếp theo của nhân viên, kể cả dùng phiên cũ; nhân viên khác không bị ảnh hưởng.
3. **Given** quyền đang hoạt động vẫn thuộc vai trò và đã bị tắt riêng, **When** bật lại, **Then** nhân viên được kế thừa quyền đó trở lại mà không thay đổi bộ quyền chung của vai trò.
4. **Given** quyền không tồn tại, đã ngừng hoạt động hoặc không thuộc vai trò nhân viên, **When** cố bật/tắt, **Then** bị từ chối; không tạo quyền mới hoặc nâng quyền cho nhân viên.
5. **Given** nhân viên không ở trạng thái `ACTIVE`, **When** yêu cầu xem hoặc thay đổi quyền qua luồng quản trị quyền hiện có, **Then** bị từ chối theo chính sách tài khoản đích hiện hành; vẫn có thể xem thông tin tài khoản qua chức năng xem chi tiết.
6. **Given** bộ quyền chung của vai trò thay đổi, **When** xác định quyền của nhân viên, **Then** quyền hiệu lực phản ánh bộ quyền hiện tại, giữ các thiết lập tắt riêng; quản trị viên nhà cung cấp không thể cấp lại quyền đã bị gỡ khỏi vai trò.

### Edge Cases

- Không cho quản trị viên quản lí chính mình, quản trị viên khác hoặc tài khoản thuộc tổ chức khác qua chức năng dành cho nhân viên.
- Thông tin tổ chức hoặc vai trò do người thực hiện tự gửi không được dùng để mở rộng phạm vi; khi tạo tài khoản, không chấp nhận các trường lựa chọn tổ chức/vai trò.
- Hai yêu cầu tạo cùng tên đăng nhập trong cùng nhà cung cấp: tối đa một yêu cầu thành công. Hai nhà cung cấp khác nhau tạo cùng tên đăng nhập và email khác nhau chưa được dùng đều được phép, kể cả khi tạo đồng thời. Hai yêu cầu tạo cùng email ở cùng hoặc khác nhà cung cấp: tối đa một yêu cầu thành công; email so sánh không phân biệt chữ hoa/thường toàn hệ thống.
- Họ tên, số điện thoại hoặc tên đăng nhập giống nhau không dùng để gộp danh tính hai nhân viên giữa các nhà cung cấp. Email của hai tài khoản phải khác nhau theo chính sách duy nhất toàn hệ thống.
- Mọi tài khoản chỉ đăng nhập bằng email và mật khẩu; không tra cứu theo username hoặc thử mật khẩu trên nhiều tài khoản. Nếu chuỗi nhập không thuộc email tài khoản nào thì từ chối, dù đó là username hợp lệ với mật khẩu đúng. Không yêu cầu mã/link hoặc lựa chọn tổ chức để phân biệt.
- Khi email của người này trùng username người khác, chỉ tài khoản sở hữu email được xét xác thực; username không chặn, không mở rộng tập tài khoản hoặc tạo đường đăng nhập dự phòng. Khôi phục mật khẩu theo email duy nhất chỉ tác động đúng một tài khoản, không ảnh hưởng người có username trùng.
- Hai thao tác tác động cùng trạng thái hoặc cùng quyền: kết quả tương đương một thứ tự xử lí hợp lệ, không có thiết lập tắt quyền trùng; thao tác lặp cùng mục tiêu an toàn.
- Quyền, vai trò hoặc tư cách thành viên của người thực hiện bị thay đổi trong lúc ghi: phải kiểm tra lại trước khi hoàn tất và từ chối nếu không còn đủ điều kiện.
- Nhà cung cấp bị vô hiệu hóa quản trị viên và các thành viên trong lúc tạo/mở khóa: không để lại tài khoản hoạt động vượt quy tắc vô hiệu hóa toàn tổ chức.
- Việc tạm dừng tiếp nhận đơn của nhà cung cấp không đồng nghĩa khóa nhân viên; quản lí tài khoản không được tự gỡ hạn chế tiếp nhận đơn hiện có.
- Lỗi giữa chừng không được tạo tài khoản thiếu vai trò/tổ chức, đổi quyền một phần hoặc báo thành công khi chưa lưu được thay đổi.
- Dữ liệu đầu vào sai nhiều trường được báo cùng các trường lỗi bằng tiếng Việt, không phản hồi mật khẩu hoặc giá trị bí mật đã nhập.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Mọi thao tác MUST yêu cầu người thực hiện đang `ACTIVE`, mang vai trò `INGREDIENT_SUPPLIER_ADMIN`, thuộc nhà cung cấp hợp lệ và có quyền hiệu lực `supplier_staff.manage`; không có ngoại lệ chỉ vì mang vai trò quản trị.
- **FR-002**: Phạm vi MUST được xác định từ nhà cung cấp của người thực hiện đã xác thực. Chỉ quản lí tài khoản `INGREDIENT_SUPPLIER_STAFF` thuộc đúng nhà cung cấp đó; không cho chọn tổ chức hoặc vai trò khác để vượt phạm vi.
- **FR-003**: Hệ thống MUST cung cấp danh sách phân trang gồm định danh, tên đăng nhập, họ tên, email, số điện thoại nếu có, vai trò và trạng thái; bao gồm mọi trạng thái nhân viên, loại trừ tài khoản quản trị viên.
- **FR-004**: Phân trang MUST mặc định trang 1, kích thước 20, tối đa 100 mỗi trang; từ chối giá trị không phải số nguyên dương hoặc vượt giới hạn. Kết quả MUST có trang, kích thước và thông tin còn trang tiếp theo; thứ tự mới tạo trước, cùng thời điểm thì theo định danh tăng dần.
- **FR-005**: Xem chi tiết MUST cung cấp các thông tin tại FR-003 cùng thời điểm tạo/cập nhật cho nhân viên ở mọi trạng thái. Tài khoản đích không tồn tại hoặc ngoài phạm vi nhân viên MUST có cùng kết quả không tìm thấy.
- **FR-006**: Tạo tài khoản MUST yêu cầu tên đăng nhập, họ tên, email, mật khẩu khởi tạo; số điện thoại là tùy chọn, có thể bỏ qua hoặc để null. MUST áp dụng quy tắc tên đăng nhập và mật khẩu hiện hành; chuẩn hóa khoảng trắng thông tin văn bản và email theo quy tắc chung, không tự cắt khoảng trắng mật khẩu. Email MUST đúng định dạng; trường bắt buộc không được rỗng sau chuẩn hóa.
- **FR-007**: Tài khoản mới MUST tự thuộc nhà cung cấp hiện tại, mang duy nhất vai trò `INGREDIENT_SUPPLIER_STAFF`, trạng thái `ACTIVE` và kế thừa quyền đang hoạt động của vai trò, chưa có quyền bị tắt riêng. Không cho tự nhập trạng thái, tổ chức hoặc vai trò khi tạo.
- **FR-008**: Tên đăng nhập nhân viên MUST duy nhất trong cùng nhà cung cấp, kể cả tài khoản đã khóa/vô hiệu hóa; MUST cho phép tên đăng nhập giống nhau giữa các nhà cung cấp. Email MUST duy nhất trong toàn hệ thống cho mọi tài khoản, kể cả tài khoản đã khóa/vô hiệu hóa, được chuẩn hóa và so sánh không phân biệt chữ hoa/thường. Khi trùng username trong cùng nhà cung cấp hoặc trùng email ở bất kỳ tổ chức nào, MUST từ chối toàn bộ việc tạo mà không tiết lộ tổ chức hoặc danh tính tài khoản ngoài phạm vi.
- **FR-009**: Tất cả vai trò trong hệ thống MUST chỉ đăng nhập bằng email duy nhất toàn hệ thống và mật khẩu. Email MUST được chuẩn hóa không phân biệt chữ hoa/thường và chỉ được đối chiếu với email tài khoản; username MUST không được dùng làm điều kiện tra cứu, phương thức thay thế hoặc dự phòng. Nếu email nhập trùng username của một tài khoản khác, MUST chỉ xét chủ email; không báo nhiều tài khoản hoặc thử mật khẩu của nhiều người. Không yêu cầu mã, lựa chọn hoặc link tổ chức riêng. Sau xác thực, MUST nạp tổ chức và quyền hiện hành từ tài khoản. Các điều kiện trạng thái, xác minh email, onboarding, phiên và quyền hiện hành MUST được giữ nguyên; không tự kích hoạt tài khoản hoặc tạo hồ sơ tổ chức vì đăng nhập. Khôi phục mật khẩu theo email duy nhất MUST chỉ tác động đúng tài khoản đó. Mật khẩu MUST được bảo vệ, không xuất hiện trong danh sách, chi tiết hoặc kết quả tạo tài khoản.
- **FR-010**: Khóa/mở khóa MUST chỉ chuyển `ACTIVE` sang `LOCKED` và `LOCKED` sang `ACTIVE`; yêu cầu đặt lại cùng trạng thái MUST an toàn. Các trạng thái khác MUST bị từ chối, không cho kích hoạt lại qua chức năng này.
- **FR-011**: Sau khi khóa thành công, nhân viên MUST bị từ chối tại lần đăng nhập, gia hạn phiên và yêu cầu nghiệp vụ tiếp theo. Mở khóa MUST cho phép đăng nhập lại theo quyền hiện tại, không yêu cầu khôi phục phiên cũ.
- **FR-012**: Khóa/mở khóa MUST giữ nguyên vai trò, tổ chức, thông tin nhân viên, lịch sử công việc và các quyền bị tắt riêng; không tự thay đổi công việc hoặc tài khoản khác.
- **FR-013**: Quản trị viên MUST xem được danh sách quyền thuộc vai trò của nhân viên `ACTIVE`, gồm định danh, mã, tên, mô tả nếu có, trạng thái hoạt động của quyền và trạng thái hiệu lực cho nhân viên đó.
- **FR-014**: Quyền hiệu lực MUST bằng các quyền đang hoạt động của vai trò trừ các quyền bị tắt riêng cho nhân viên trong nhà cung cấp hiện tại. Thay đổi MUST có hiệu lực từ yêu cầu nghiệp vụ tiếp theo, kể cả với phiên đang đăng nhập.
- **FR-015**: Quản trị viên MUST chỉ bật/tắt quyền đang hoạt động đã thuộc vai trò nhân viên, với tài khoản đích `ACTIVE`. MUST từ chối quyền không tồn tại, ngừng hoạt động hoặc ngoài vai trò; không sửa bộ quyền chung hoặc tạo quyền mới.
- **FR-016**: Tắt quyền MUST chỉ hạn chế nhân viên được chọn; bật lại MUST khôi phục việc kế thừa quyền đó. Thao tác lặp MUST an toàn; khi bộ quyền vai trò thay đổi, MUST bảo toàn thiết lập tắt riêng và không tự cấp lại quyền ngoài vai trò.
- **FR-017**: Mọi thao tác ghi MUST kiểm tra lại trạng thái, vai trò, quyền và tổ chức hiện hành của người thực hiện, đồng thời kiểm tra phạm vi/trạng thái đích trước khi hoàn tất. Các thay đổi liên quan MUST toàn bộ thành công hoặc toàn bộ không thay đổi.
- **FR-018**: Thao tác đồng thời MUST giữ tính duy nhất của tài khoản, kết quả khóa/mở khóa và quyền nhất quán, không vượt quy tắc vô hiệu hóa tài khoản toàn tổ chức hiện có. Nếu không bảo đảm điều kiện, MUST từ chối và cho phép thử lại.
- **FR-019**: Kết quả và lỗi MUST tuân theo quy ước phản hồi hiện hành, có thông báo tiếng Việt. Dữ liệu sai MUST báo các trường lỗi cùng nhau; không lộ thông tin bí mật hay dữ liệu ngoài phạm vi.

### Key Entities _(include if feature involves data)_

- **Quản trị viên nhà cung cấp**: Người quản lí có vai trò `INGREDIENT_SUPPLIER_ADMIN`, tổ chức hiện tại và quyền hiệu lực phù hợp.
- **Nhân viên nhà cung cấp**: Tài khoản `INGREDIENT_SUPPLIER_STAFF` thuộc một nhà cung cấp, có định danh tài khoản riêng, thông tin liên hệ, mật khẩu, trạng thái và quyền riêng. Tên đăng nhập có thể giống tài khoản thuộc nhà cung cấp khác; email phải duy nhất toàn hệ thống. Không dùng tên đăng nhập đơn lẻ làm căn cứ gộp hoặc chọn danh tính.
- **Nhà cung cấp nguyên liệu**: Đơn vị sở hữu quản trị viên và nhiều nhân viên; xác định ranh giới quản lí tài khoản.
- **Quyền của vai trò nhân viên**: Bộ quyền do quản trị hệ thống quản lí, tạo giới hạn cao nhất cho quyền truy cập nhân viên.
- **Thiết lập tắt quyền riêng**: Hạn chế một quyền cho đúng nhân viên trong nhà cung cấp hiện tại; được giữ khi khóa/mở khóa hoặc thay đổi bộ quyền chung.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% kịch bản xem danh sách/chi tiết chỉ hiển thị nhân viên đúng nhà cung cấp; số tài khoản quản trị hoặc tài khoản ngoài phạm vi bị lộ bằng 0.
- **SC-002**: 100% lần tạo hợp lệ cho đúng một tài khoản nhân viên có thể đăng nhập, đúng vai trò/tổ chức. Hai nhà cung cấp khác nhau tạo cùng tên đăng nhập với email khác nhau chưa được dùng đều thành công khi các trường khác hợp lệ và mỗi staff đăng nhập vào đúng tài khoản bằng email của mình. Trùng username trong cùng nhà cung cấp hoặc trùng email ở bất kỳ tổ chức nào đều bị từ chối và không tạo tài khoản một phần.
- **SC-003**: 100% tài khoản vừa bị khóa bị từ chối ở lần đăng nhập, gia hạn phiên và truy cập nghiệp vụ tiếp theo; mở khóa không khôi phục bất kỳ quyền nào đã bị tắt riêng.
- **SC-004**: 100% kịch bản bật/tắt quyền chỉ tác động nhân viên được chọn và không cấp quyền ngoài vai trò; thay đổi có hiệu lực ở lần truy cập tiếp theo, không cần nhân viên đăng nhập lại.
- **SC-005**: Toàn bộ tình huống thiếu quyền, vượt tổ chức, lỗi giữa chừng và cập nhật đồng thời không có thay đổi trái phép, dữ liệu một phần hoặc thông báo thành công sai.
- **SC-006**: Trong nghiệm thu với dữ liệu hợp lệ đã chuẩn bị, ít nhất 90% quản trị viên tham gia hoàn thành từng tác vụ xem danh sách, xem chi tiết, tạo tài khoản, khóa/mở khóa và bật/tắt một quyền ngay lần đầu mà không cần hỗ trợ; tạo tài khoản hoàn thành trong tối đa 2 phút, mỗi tác vụ còn lại trong tối đa 1 phút.

- **SC-007**: Trong 100% kịch bản đăng nhập cho từng vai trò đủ điều kiện hiện hành, email và mật khẩu đúng xác thực đúng chủ email; username đơn lẻ không cấp phiên nếu không khớp email nào. Khi một email trùng username người khác, đúng một chủ email được xét, không có lỗi nhiều tài khoản hoặc phiên của người có username trùng; trạng thái, onboarding và quyền vẫn được áp dụng như hiện hành.

## Assumptions

- “Nhân viên” chỉ là vai trò `INGREDIENT_SUPPLIER_STAFF`; quản trị viên nhà cung cấp không phải đối tượng quản lí của tính năng này. Không tạo vai trò mới và không giới hạn số nhân viên bằng quy tắc một quản trị viên mỗi nhà cung cấp.
- Mặc định quản trị viên nhập mật khẩu khởi tạo khi tạo nhân viên và chuyển thông tin đăng nhập cho nhân viên ngoài hệ thống; không dùng chung mật khẩu mặc định. Tính năng không bổ sung thư mời, gửi mật khẩu, bắt buộc đổi mật khẩu lần đầu hoặc luồng xác minh email riêng.
- Khóa được hiểu là `LOCKED`, mở khóa là trở về `ACTIVE`. `DEACTIVATED` thuộc luồng vô hiệu hóa hiện có; không bổ sung quyền khôi phục trạng thái này cho quản trị viên nhà cung cấp.
- Chính sách chỉ quản trị quyền cho tài khoản đích `ACTIVE` được kế thừa từ [chính sách phân quyền](../../docs/AUTHORIZATION.md). Khi nhân viên bị khóa, quản trị viên có thể xem chi tiết và mở khóa trước khi quản lí quyền.
- Tạm dừng tiếp nhận đơn và khóa tài khoản là hai giới hạn độc lập, kế thừa [đặc tả vòng đời tài khoản](../022-account-deactivation/spec.md); không tự chặn quản lí nhân viên chỉ vì nhà cung cấp tạm dừng tiếp nhận đơn nếu người thực hiện vẫn đủ điều kiện.
- Phạm vi quản lí nhân viên vẫn gồm năm nhóm thao tác đã yêu cầu; bổ sung thay đổi phương thức đăng nhập email-only cho tất cả vai trò theo quyết định ngày 2026-11-17. Sửa hồ sơ nhân viên, đổi vai trò, xóa tài khoản, đặt lại mật khẩu qua quản trị, tìm kiếm/lọc nâng cao, quản lí nhân sự trường và thay đổi bộ quyền toàn hệ thống không nằm trong phạm vi.
- Phụ thuộc luồng đăng nhập, trạng thái tài khoản, vai trò nhân viên, quyền `supplier_staff.manage`, bộ quyền vai trò và cơ chế tắt quyền riêng hiện có. Quy tắc tên đăng nhập kế thừa [quy tắc đăng ký hiện hành](../../src/modules/auth/signup.validation.ts); mật khẩu kế thừa [chính sách mật khẩu hiện hành](../../src/modules/auth/password.validation.ts). Các giới hạn trường chi tiết sẽ được ghi trong hợp đồng ở bước lập kế hoạch, không mở rộng dữ liệu nghiệp vụ.
- Đặc tả xác định hành vi nghiệp vụ cho backend hiện tại; thiết kế giao diện mới không thuộc phạm vi. Tiêu chí thời gian thao tác được đánh giá qua ứng dụng sử dụng chức năng này khi nghiệm thu. Bước đặc tả không thay đổi dữ liệu vận hành.

- Username nhân viên chỉ duy nhất trong cùng nhà cung cấp, được trùng giữa các nhà cung cấp; email duy nhất toàn hệ thống. Quy tắc lưu trữ và uniqueness username đã chốt giữ nguyên, nhưng mọi vai trò đều chỉ đăng nhập bằng email + mật khẩu. Tài khoản đang dùng username để đăng nhập sẽ chuyển sang dùng email đã có, không tự đổi tên, mật khẩu hoặc tổ chức. Khôi phục mật khẩu tiếp tục dùng email duy nhất; không thêm mã/link/lựa chọn tổ chức hoặc chức năng quản trị đặt lại mật khẩu nhân viên.
- Plan, research, data-model, contracts và quickstart đã cập nhật theo email-only toàn hệ thống ngày 2026-11-17: chỉ lookup unique email, recheck email/hash sau lock và hồi quy SC-007 mọi role. Bộ 64 tasks đã triển khai bỏ username/ambiguity login cho mọi role, thêm auth normalization, fixtures/runner regression tương ứng. I1 đã được kiểm chứng bằng unit và PostgreSQL integration; kết quả tại quickstart.md. Migration chỉ đã chạy trên database disposable của tác vụ, chưa áp trên member/Azure. SC-006 là nghiệm thu qua ứng dụng chưa thực hiện.

## CI regression — retry khi đọc lại actor

Theo FR-017/FR-018, xung đột serialization tạm thời trong bước đọc actor trước/sau khóa phải được chuyển nguyên trạng đến transaction runner để retry toàn giao dịch trong giới hạn ba lần. Không chuyển sớm thành HTTP503 trước khi runner xử lý. Kiểm tra actor ACTIVE, role, membership và effective permissions vẫn bắt buộc mỗi lần thử; lỗi business401/403 không được coi là lỗi serialization. Hết retry hoặc lỗi hạ tầng không retry được vẫn trả503 an toàn, không lộ thông tin driver.
