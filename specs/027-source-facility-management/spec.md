# Feature Specification: Quản lý cơ sở cung cấp nguyên liệu

**Feature Branch**: `feat/027-source-facility-management`

**Created**: 2026-11-14

**Status**: Implemented — đã kiểm chứng unit/HTTP và PostgreSQL local tạm

**Input**: User description: "Tôi muốn tạo chức năng bên nhà cung cấp nguyên liệu, cho phép tạo các cơ sở cung cấp là source facility, chức năng này chỉ admin của nhà cung cấp mới thực hiện được bao gồm: thêm, sửa, dừng hoạt động không có xóa. Các API như: trả về một list, một trang chi tiết của cơ sở cung cấp đó, thêm, sửa, dừng hoạt động."

## Clarifications

### Session 2026-11-14

- Q: Phần số trong mã cơ sở được đánh riêng theo nhà cung cấp, dùng chung toàn hệ thống hay lấy từ mã hồ sơ đăng ký? → A: Phương án A — hệ thống tự sinh `facilityCode` theo dãy riêng của từng nhà cung cấp, bắt đầu `FP-SF-00001`, tiếp theo `FP-SF-00002`; nhà cung cấp khác cũng bắt đầu `FP-SF-00001`. Mã chỉ dùng cách định dạng tương tự mã hồ sơ đăng ký, không lấy phần số của hồ sơ. Cơ sở thuộc riêng từng nhà cung cấp, không phải danh mục dùng chung; người dùng không nhập hoặc sửa mã.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Thêm cơ sở cung cấp của mình (Priority: P1)

Quản trị viên nhà cung cấp khai báo cơ sở cung cấp nguyên liệu của tổ chức mình, kèm thông tin liên hệ để quản lý nguồn cung.

**Why this priority**: Tạo cơ sở là bước đầu để nhà cung cấp có danh mục nguồn cung thuộc sở hữu của mình.

**Independent Test**: Quản trị viên A tạo cơ sở hợp lệ, đối chiếu thông tin và chủ sở hữu; thử lại bằng nhân viên và dữ liệu trùng để kiểm tra giới hạn.

**Acceptance Scenarios**:

1. **Given** quản trị viên A và nhà cung cấp A đang hoạt động, người dùng có quyền quản lý cơ sở hiệu lực, **When** thêm cơ sở có tên hợp lệ, **Then** cơ sở được tạo thuộc A, mặc định đang hoạt động, có định danh riêng và thông tin người/thời điểm tạo, cập nhật.
2. **Given** quản trị viên A đủ quyền, **When** gửi thêm địa chỉ, tên người liên hệ, số điện thoại và email hợp lệ, **Then** các thông tin được lưu đúng, mã cơ sở do hệ thống tự sinh; thông tin tùy chọn được phép bỏ trống.
3. **Given** A có cơ sở mang tên đã nhập, kể cả cơ sở đã dừng, **When** tạo cơ sở trùng tên theo quy tắc hiện hành, **Then** bị từ chối và không phát sinh bản ghi mới; cùng tên ở B không gây xung đột cho A.
4. **Given** nhân viên A hoặc vai trò khác, kể cả được gán quyền quản lý cơ sở, **When** thêm cơ sở, **Then** bị từ chối và không tạo dữ liệu.
5. **Given** quản trị viên A, **When** gửi `facilityCode`, thông tin để chỉ định nhà cung cấp B hoặc tự đặt trạng thái, **Then** yêu cầu bị từ chối và không tạo cơ sở.
6. **Given** quản trị viên A đủ quyền, **When** chỉ gửi `name` hợp lệ, **Then** cơ sở được tạo thành công, có mã hệ thống tự sinh và bốn trường tùy chọn không có giá trị; nếu thiếu `name`, gửi `name` là null hoặc chỉ có khoảng trắng thì bị từ chối và không tạo cơ sở.
7. **Given** A và B chưa từng được cấp mã cơ sở, **When** A tạo hai cơ sở rồi B tạo cơ sở đầu tiên, **Then** A nhận `FP-SF-00001`, `FP-SF-00002`, B nhận `FP-SF-00001`; mỗi cơ sở có định danh riêng và chỉ được quản lý bởi chủ sở hữu đủ quyền.
8. **Given** nhiều yêu cầu tạo cơ sở có tên khác nhau đồng thời trong cùng A, **When** các yêu cầu thành công, **Then** mọi cơ sở mới có mã đúng định dạng và không trùng trong A, không làm tăng dãy mã của B.

---

### User Story 2 - Xem danh sách và chi tiết cơ sở (Priority: P1)

Quản trị viên xem các cơ sở của nhà cung cấp mình và mở thông tin chi tiết từng cơ sở để kiểm tra thông tin liên hệ và tình trạng hoạt động.

**Why this priority**: Danh sách và chi tiết giúp chọn đúng cơ sở trước khi cập nhật hoặc dừng hoạt động.

**Independent Test**: Chuẩn bị cơ sở đang hoạt động và đã dừng của A, cùng cơ sở của B; kiểm tra danh sách phân trang và chi tiết bằng quản trị viên A.

**Acceptance Scenarios**:

1. **Given** A có cơ sở đang hoạt động và đã dừng, **When** quản trị viên A xem danh sách, **Then** chỉ thấy cơ sở thuộc A, bao gồm cả hai trạng thái, mỗi mục có định danh, tên, mã cơ sở và trạng thái.
2. **Given** số cơ sở của A vượt kích thước một trang, **When** xem lần lượt các trang trên tập dữ liệu không thay đổi, **Then** thứ tự ổn định, không lặp hoặc bỏ sót cơ sở, có thông tin cho biết còn trang tiếp theo hay không.
3. **Given** cơ sở thuộc A, **When** mở chi tiết, **Then** nhận đúng định danh, nhà cung cấp sở hữu, mã, tên, địa chỉ, thông tin liên hệ, trạng thái, thông tin hiển thị và thời điểm tạo/cập nhật.
4. **Given** A chưa có cơ sở hoặc trang được yêu cầu không có kết quả, **When** xem danh sách, **Then** nhận danh sách rỗng cùng thông tin phân trang hợp lệ.
5. **Given** quản trị viên A, **When** yêu cầu chi tiết cơ sở thuộc B hoặc định danh hợp lệ nhưng không tồn tại, **Then** nhận cùng kết quả không tìm thấy, không biết cơ sở của B có tồn tại hay không.
6. **Given** nhân viên, quản trị hệ thống hoặc vai trò khác có quyền quản lý cơ sở, **When** xem danh sách hoặc chi tiết trong chức năng này, **Then** bị từ chối; không có ngoại lệ truy cập toàn hệ thống.

---

### User Story 3 - Sửa thông tin cơ sở (Priority: P2)

Quản trị viên cập nhật thông tin cơ sở của tổ chức mình khi tên, địa chỉ hoặc người liên hệ thay đổi.

**Why this priority**: Thông tin nguồn cung cần chính xác trong quá trình vận hành, đồng thời giữ nguyên định danh phục vụ truy xuất.

**Independent Test**: Sửa địa chỉ và thông tin liên hệ của cơ sở A, đọc lại kết quả và kiểm tra các trường không gửi, định danh, chủ sở hữu và trạng thái vẫn giữ nguyên.

**Acceptance Scenarios**:

1. **Given** cơ sở thuộc A, **When** quản trị viên A sửa một hoặc nhiều thông tin hợp lệ, **Then** chỉ các trường được gửi được thay đổi, đồng thời ghi nhận người cập nhật và thời điểm cập nhật.
2. **Given** cơ sở có thông tin liên hệ tùy chọn, **When** quản trị viên bỏ giá trị tùy chọn bằng giá trị rỗng được chấp nhận, **Then** thông tin đó được bỏ, các thông tin còn lại và mã cơ sở được giữ nguyên.
3. **Given** cơ sở đã dừng, **When** quản trị viên sửa thông tin, **Then** thông tin được cập nhật nhưng cơ sở vẫn dừng hoạt động.
4. **Given** quản trị viên gửi tên rỗng, email sai định dạng, tên trùng cơ sở khác của A, `facilityCode`, yêu cầu sửa rỗng hoặc trường không được phép sửa, **When** lưu, **Then** toàn bộ thay đổi bị từ chối và dữ liệu cũ được giữ nguyên.
5. **Given** quản trị viên A, **When** sửa cơ sở của B hoặc cơ sở không tồn tại, **Then** nhận cùng kết quả không tìm thấy và không thay đổi dữ liệu nào.

---

### User Story 4 - Dừng hoạt động và giữ lịch sử cơ sở (Priority: P2)

Quản trị viên đánh dấu cơ sở không còn hoạt động, vẫn giữ thông tin cơ sở và các liên kết truy xuất nguồn gốc đã ghi nhận.

**Why this priority**: Nhà cung cấp cần quản lý tình trạng nguồn cung mà không làm mất lịch sử các lô nguyên liệu.

**Independent Test**: Dừng cơ sở có lô nguyên liệu liên quan, kiểm tra trạng thái mới trong danh sách/chi tiết, đối chiếu liên kết lịch sử rồi dừng lần nữa.

**Acceptance Scenarios**:

1. **Given** cơ sở thuộc A đang hoạt động, **When** quản trị viên A dừng hoạt động, **Then** trạng thái chuyển sang không hoạt động, thông tin và mã cơ sở được giữ, có thể đọc tiếp trong quản trị; tạo cơ sở tiếp theo không tái sử dụng mã của cơ sở đã dừng.
2. **Given** cơ sở đã liên kết với các lô nguyên liệu, **When** dừng hoạt động, **Then** các lô và liên kết với cơ sở vẫn nguyên vẹn, không tự hủy hay thay đổi nghiệp vụ đã ghi nhận.
3. **Given** cơ sở đã dừng, **When** gửi lại yêu cầu dừng, **Then** thao tác vẫn thành công với trạng thái không hoạt động, không tạo cơ sở mới.
4. **Given** quản trị viên A, **When** dừng cơ sở thuộc B hoặc cơ sở không tồn tại, **Then** nhận cùng kết quả không tìm thấy và không thay đổi cơ sở nào.
5. **Given** tài khoản, tổ chức hoặc quyền quản lý không còn hợp lệ, **When** tiếp tục yêu cầu dừng bằng phiên cũ, **Then** bị từ chối và trạng thái cơ sở không thay đổi.

### Edge Cases

- Chưa đăng nhập, tài khoản bị khóa/ngừng hoạt động, tổ chức ngừng hoạt động, thiếu quan hệ nhà cung cấp hoặc quyền bị thu hồi: không được thực hiện bất kỳ thao tác nào trong năm thao tác.
- Nhân viên được gán quyền quản lý cơ sở vẫn không đáp ứng điều kiện vai trò; quản trị hệ thống không có quyền truy cập ngầm.
- Định danh sai định dạng, phân trang sai, yêu cầu sửa rỗng hoặc trường ngoài phạm vi được nhận: từ chối bằng lỗi rõ ràng.
- Tên chỉ có khoảng trắng hoặc dài hơn 255 ký tự; tên người liên hệ dài hơn 255 ký tự; số điện thoại dài hơn 30 ký tự; email không đúng định dạng: báo lỗi theo trường, không ghi một phần dữ liệu.
- Người dùng gửi `facilityCode` khi thêm hoặc sửa, kể cả gửi null, chuỗi rỗng hay mã đúng định dạng: từ chối vì đây là trường do hệ thống tự quản lý.
- Tên và mã đã dùng ở cơ sở dừng vẫn tham gia kiểm tra trùng trong cùng nhà cung cấp; cơ sở mới không được thiếu mã hoặc tái sử dụng mã đã cấp.
- Hai yêu cầu đồng thời tạo hoặc sửa về cùng tên: không được xuất hiện hai cơ sở vi phạm quy tắc duy nhất; yêu cầu thất bại nhận lỗi xung đột dễ hiểu. Các yêu cầu tạo tên khác nhau đồng thời không được cấp trùng mã trong cùng nhà cung cấp.
- Hai nhà cung cấp có cùng `facilityCode` là hợp lệ; mọi thao tác vẫn xác định đúng cơ sở bằng định danh riêng và phạm vi nhà cung cấp đã xác thực, không suy ra chủ sở hữu chỉ từ mã cơ sở.
- Vượt số 99999: mã tiếp theo mở rộng thành `FP-SF-100000`, không cắt chữ số, quay vòng hoặc ảnh hưởng dãy của nhà cung cấp khác. Dừng hoạt động không làm đặt lại dãy; dãy được phép có khoảng trống nếu một lần tạo thất bại.
- Quyền hoặc chủ thể thao tác thay đổi trước khi ghi: kiểm tra lại điều kiện truy cập khi thực hiện thay đổi, không chỉ dựa vào lần kiểm tra lúc bắt đầu.
- Dừng rồi sửa không được kích hoạt lại cơ sở; dừng lặp không được xóa cơ sở hoặc làm mất liên kết lịch sử.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp năm thao tác: xem danh sách, xem chi tiết một cơ sở, thêm, sửa và dừng hoạt động cơ sở cung cấp.
- **FR-002**: Cả năm thao tác MUST chỉ cho phép tài khoản đang hoạt động mang vai trò quản trị viên nhà cung cấp nguyên liệu (`INGREDIENT_SUPPLIER_ADMIN`), thuộc nhà cung cấp đang hoạt động và có quyền `source_facility.manage` hiệu lực. Nhân viên và mọi vai trò khác bị từ chối kể cả có quyền này; không có ngoại lệ cho quản trị hệ thống.
- **FR-003**: Hệ thống MUST xác định nhà cung cấp từ danh tính và quan hệ tổ chức hiện tại đã xác thực, giới hạn mọi lần đọc/ghi trong nhà cung cấp đó. Mỗi cơ sở thuộc đúng một nhà cung cấp; đây không phải danh mục cơ sở dùng chung toàn hệ thống. Không nhận thông tin từ người dùng để chọn hoặc chuyển chủ sở hữu cơ sở.
- **FR-004**: Thêm cơ sở MUST chỉ nhận năm trường nhập `name`, `address`, `contactName`, `contactPhone`, `contactEmail` theo bảng bên dưới. Chỉ `name` bắt buộc, không được thiếu, null hoặc rỗng sau khi bỏ khoảng trắng đầu/cuối, tối đa 255 ký tự. Bốn trường còn lại là tùy chọn; nếu không nhập thì không có giá trị.
- **FR-005**: Cơ sở mới MUST được cấp mã tự động theo FR-017, mặc định đang hoạt động (`ACTIVE`), giữ mặc định hiển thị hiện có và được ghi nhận người tạo, người cập nhật cùng thời điểm tương ứng. Người dùng không được tự đặt định danh, mã cơ sở, chủ sở hữu, trạng thái, cờ hiển thị hoặc thông tin ghi nhận này.
- **FR-006**: Tên cơ sở MUST duy nhất trong từng nhà cung cấp, kể cả cơ sở đã dừng, theo quy tắc so sánh hiện hành. Mã do hệ thống cấp MUST duy nhất trong từng nhà cung cấp nhưng được phép giống mã của nhà cung cấp khác. Xung đột tên, kể cả thao tác đồng thời, phải bị từ chối mà không ghi một phần dữ liệu; cấp mã đồng thời phải bảo đảm không trùng mã trong cùng nhà cung cấp.
- **FR-007**: Danh sách quản trị MUST chỉ gồm cơ sở của nhà cung cấp hiện tại, bao gồm cả đang hoạt động và đã dừng; giữ thông tin danh sách an toàn hiện có, có trạng thái và thứ tự ổn định. Phân trang mặc định trang 1, 20 mục/trang, tối đa 100 mục/trang, có chỉ báo còn trang tiếp theo; trang không có dữ liệu trả danh sách rỗng.
- **FR-008**: Chi tiết MUST cung cấp định danh, nhà cung cấp sở hữu, mã cơ sở, tên, địa chỉ, tên/số điện thoại/email liên hệ, trạng thái, thông tin hiển thị hiện có và thời điểm tạo/cập nhật; thông tin tùy chọn chưa có được biểu diễn nhất quán. Không trả thông tin tài khoản hoặc dữ liệu nội bộ ngoài nội dung cơ sở được phép xem.
- **FR-009**: Sửa MUST chỉ cho thay đổi tên, địa chỉ và thông tin liên hệ. Trường không gửi giữ nguyên; trường tùy chọn cho phép bỏ giá trị; tên không được bỏ. Yêu cầu sửa phải có ít nhất một trường được phép và không được thay đổi định danh, mã cơ sở, chủ sở hữu, trạng thái hoặc cờ hiển thị. Gửi `facilityCode` dưới bất kỳ giá trị nào khi thêm hoặc sửa đều bị từ chối.
- **FR-010**: Văn bản được nhận MUST bỏ khoảng trắng đầu/cuối; trường tùy chọn nhận chuỗi rỗng, chỉ có khoảng trắng hoặc giá trị null được xem là không có thông tin. Áp dụng nhất quán khi thêm và sửa, trước khi kiểm tra hợp lệ và trùng.
- **FR-011**: Dừng hoạt động MUST chuyển cơ sở thuộc sở hữu từ `ACTIVE` sang `INACTIVE`, giữ dữ liệu và mọi liên kết lô nguyên liệu đã có. Không tự thay đổi cờ hiển thị hoặc trạng thái hồ sơ liên quan. Dừng lặp trên cơ sở `INACTIVE` được xử lý thành công mà không tạo cơ sở mới.
- **FR-012**: Cơ sở `INACTIVE` MUST vẫn xem và sửa được theo cùng điều kiện phân quyền; sửa không được kích hoạt lại. Chức năng này không cung cấp xóa hoặc kích hoạt lại cơ sở.
- **FR-013**: Xem chi tiết, sửa hoặc dừng cơ sở ngoài sở hữu MUST trả cùng kết quả không tìm thấy như định danh hợp lệ nhưng không tồn tại, không tiết lộ dữ liệu hay sự tồn tại của cơ sở nhà cung cấp khác.
- **FR-014**: Hệ thống MUST kiểm tra tài khoản, vai trò, quyền hiệu lực và nhà cung cấp hiện tại ở mỗi yêu cầu; thao tác ghi phải kiểm tra lại các điều kiện cùng với cơ sở đích trong cùng một đơn vị thay đổi toàn vẹn. Nếu không còn đủ điều kiện, không thực hiện thay đổi.
- **FR-015**: Dữ liệu không hợp lệ, định danh sai, yêu cầu sửa rỗng, phân trang sai hoặc trường không được phép MUST bị từ chối bằng thông báo tiếng Việt kèm trường liên quan; gom các lỗi nhập liệu trong cùng yêu cầu, không lộ giá trị nhạy cảm. Thất bại không được lưu dữ liệu dở dang; giữ định dạng phản hồi thành công/lỗi và phân trang hiện hành.
- **FR-016**: Mọi lần sửa thành công và lần chuyển sang dừng hoạt động MUST ghi nhận đúng người cập nhật và thời điểm cập nhật; không thay đổi người tạo hoặc thời điểm tạo ban đầu.
- **FR-017**: Hệ thống MUST tự sinh `facilityCode` khi tạo cơ sở theo dãy số tăng riêng của từng nhà cung cấp: tiền tố cố định `FP-SF-` và số nguyên dương được thêm số 0 bên trái cho đủ tối thiểu năm chữ số. Dãy bắt đầu từ `FP-SF-00001`, tiếp theo `FP-SF-00002`; nhà cung cấp khác bắt đầu lại từ `FP-SF-00001`. Chỉ kế thừa cách định dạng mã hồ sơ đăng ký, không dùng phần số hồ sơ hay dãy cấp số hồ sơ. Mỗi cơ sở tạo thành công phải có mã, giữ nguyên trong suốt vòng đời; dừng hoạt động không đặt lại dãy hoặc giải phóng mã đã cấp. Không yêu cầu dãy liên tục không có khoảng trống; khi vượt 99999 phải giữ đầy đủ chữ số, ví dụ `FP-SF-100000`.

**Các trường người dùng nhập khi thêm cơ sở (FR-004)**:

| Trường         | Ý nghĩa                         | Bắt buộc | Quy tắc nhập                                                                                                           |
| -------------- | ------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`         | Tên cơ sở cung cấp              | Có       | Chuỗi không rỗng sau khi bỏ khoảng trắng đầu/cuối, tối đa 255 ký tự; không trùng tên cơ sở khác của cùng nhà cung cấp. |
| `address`      | Địa chỉ cơ sở cung cấp          | Không    | Chuỗi địa chỉ; có thể bỏ trống.                                                                                        |
| `contactName`  | Họ tên người liên hệ của cơ sở  | Không    | Chuỗi tối đa 255 ký tự.                                                                                                |
| `contactPhone` | Số điện thoại liên hệ của cơ sở | Không    | Chuỗi tối đa 30 ký tự, giữ nguyên số 0 đầu và dấu `+` nếu có.                                                          |
| `contactEmail` | Email liên hệ của cơ sở         | Không    | Chuỗi đúng định dạng email khi có giá trị.                                                                             |

Tất cả giá trị văn bản được bỏ khoảng trắng đầu/cuối trước khi kiểm tra. Bốn trường tùy chọn có thể không gửi, gửi null hoặc chuỗi rỗng; khi thêm, các cách này đều được ghi nhận là không có thông tin. Quy tắc không trùng tên bao gồm cả cơ sở đã dừng và giữ cách so sánh hiện hành (FR-006, FR-010).

**Các trường hệ thống tự xác định khi thêm (FR-003, FR-005, FR-017)**:

| Trường                               | Giá trị do hệ thống xác định                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `id`                                 | Định danh duy nhất của cơ sở mới.                                                                  |
| `facilityCode`                       | Mã tự sinh theo dãy riêng của nhà cung cấp, bắt đầu `FP-SF-00001`; người dùng không nhập hoặc sửa. |
| `supplierId`                         | Nhà cung cấp hiện tại của quản trị viên đã được xác thực.                                          |
| `status`                             | Mặc định `ACTIVE` (đang hoạt động).                                                                |
| `isVisible`                          | Mặc định `true` theo quy tắc hiển thị hiện có.                                                     |
| `createdByUserId`, `updatedByUserId` | Tài khoản quản trị viên thực hiện tạo cơ sở.                                                       |
| `createdAt`, `updatedAt`             | Thời điểm hệ thống ghi nhận tạo cơ sở.                                                             |

Người dùng chỉ nhập năm trường trong bảng đầu; gửi bất kỳ trường nào trong bảng hệ thống tự xác định hoặc trường khác đều bị từ chối, không dùng giá trị do người dùng gửi để ghi đè.

### Key Entities

- **Cơ sở cung cấp (`SourceFacility`)**: Cơ sở nguồn cung/sản xuất thuộc riêng một nhà cung cấp, không dùng chung giữa các nhà cung cấp; có định danh riêng, mã `facilityCode` hệ thống tự sinh khi tạo, tên, địa chỉ, thông tin liên hệ, trạng thái `ACTIVE`/`INACTIVE`, cờ hiển thị và thông tin người/thời điểm tạo, cập nhật hiện có.
- **Nhà cung cấp (`Supplier`)**: Chủ sở hữu cơ sở, xác định ranh giới quản lý và phạm vi duy nhất của tên/mã cơ sở.
- **Dãy mã cơ sở của nhà cung cấp**: Dãy số riêng dùng để cấp mã `FP-SF-…` cho cơ sở của nhà cung cấp đó; độc lập với nhà cung cấp khác và với mã hồ sơ đăng ký. Mã cơ sở không phải định danh duy nhất toàn hệ thống và không thay thế định danh riêng của cơ sở.
- **Quản trị viên nhà cung cấp**: Tài khoản có quan hệ nhà cung cấp hợp lệ và quyền quản lý cơ sở hiệu lực; là người duy nhất được sử dụng năm thao tác trong phạm vi này.
- **Lô nguyên liệu (`IngredientLot`)**: Hồ sơ hiện có có thể tham chiếu cơ sở; liên kết và nội dung đã ghi nhận được bảo toàn khi cơ sở thay đổi thông tin hoặc dừng hoạt động.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Cả 5/5 thao tác được quản trị viên đủ điều kiện hoàn thành trên cơ sở của mình; 100% trường hợp thêm/sửa hợp lệ đọc lại đúng thông tin đã lưu.
- **SC-002**: 100% kịch bản nhân viên, vai trò khác, tài khoản/tổ chức không hoạt động, thiếu quyền, quyền bị thu hồi hoặc truy cập chéo nhà cung cấp bị chặn; không tiết lộ hoặc thay đổi dữ liệu ngoài phạm vi.
- **SC-003**: Với ít nhất 45 cơ sở của một nhà cung cấp và kích thước trang mặc định 20, xem đủ các trang thu được đúng toàn bộ cơ sở, không trùng hoặc thiếu trên tập dữ liệu không thay đổi và không lẫn cơ sở nhà cung cấp khác.
- **SC-004**: 100% cơ sở dừng vẫn xuất hiện với đúng trạng thái trong quản trị, giữ nguyên định danh và toàn bộ liên kết lô trước đó; dừng lặp hoặc sửa không kích hoạt lại hay xóa cơ sở.
- **SC-005**: 100% trường hợp dữ liệu không hợp lệ, tên trùng trong cùng nhà cung cấp hoặc tự gửi mã cơ sở khi thêm/sửa đều bị từ chối trọn vẹn, có lỗi xác định được trường cần sửa, không làm mất dữ liệu đã lưu trước đó.
- **SC-006**: 100% cơ sở mới tạo thành công có mã đúng định dạng, không trùng trong cùng nhà cung cấp, kể cả khi tạo đồng thời. Hai nhà cung cấp chưa từng cấp mã đều nhận `FP-SF-00001` cho cơ sở đầu tiên; mọi lần sửa hoặc dừng giữ nguyên mã và không ảnh hưởng dãy của nhà cung cấp khác.

## Assumptions

- Phạm vi là chức năng backend với năm thao tác yêu cầu; “trang chi tiết” được hiểu là cung cấp dữ liệu một cơ sở cho bên sử dụng. Thiết kế/giao diện trang nằm ngoài phạm vi đặc tả này.
- Tái sử dụng thuộc tính cơ sở, trạng thái, quan hệ nhà cung cấp, quyền và phạm vi duy nhất tên/mã hiện có; bổ sung nghiệp vụ tự cấp mã riêng cho từng nhà cung cấp theo FR-017. Không bổ sung loại cơ sở, chứng nhận, ảnh, tọa độ hoặc quyền mới.
- “Chỉ admin của nhà cung cấp” áp dụng cho cả năm thao tác. Danh sách cơ sở hiện có phải tuân thủ giới hạn này; việc siết quyền được ghi rõ thay vì tiếp tục mở cho vai trò khác chỉ vì có quyền quản lý.
- Danh sách giữ phân trang hiện có; chưa bổ sung tìm kiếm, lọc trạng thái hoặc sắp xếp tùy chọn. Cơ sở đã dừng vẫn có trong quản trị, không bị loại bởi cờ hiển thị hiện có.
- Sửa cơ sở đã dừng và dừng lặp được cho phép như các mặc định. Kích hoạt lại, xóa, ẩn/hiện riêng và nhập hàng loạt chưa thuộc phạm vi.
- Dừng là thay đổi trạng thái cơ sở, không tự hủy lô, đơn hàng hoặc nghiệp vụ liên quan. Bổ sung quy tắc chọn cơ sở cho giao dịch/lô mới ở module khác cần đặc tả riêng; không chặn dừng chỉ vì có lô lịch sử.
- Tên giữ cách so sánh duy nhất hiện hành sau khi chuẩn hóa khoảng trắng đầu/cuối; không tự thêm quy tắc không phân biệt hoa/thường hoặc dấu tiếng Việt. Mã luôn do hệ thống cấp với tiền tố viết hoa `FP-SF-` và không phụ thuộc tên cơ sở.
- Mặc định cấp mã tương tự cách định dạng mã hồ sơ: tối thiểu năm chữ số, mở rộng khi cần và cho phép khoảng trống nếu tạo thất bại. Phạm vi dãy riêng theo nhà cung cấp là yêu cầu đã xác nhận. Cơ chế cấp số và xử lý dữ liệu cơ sở cũ nếu có sẽ được xác định ở bước plan, bảo toàn định danh, chủ sở hữu, mã đã cấp và liên kết lịch sử, không âm thầm đánh lại mã.
- Lập đặc tả không bao gồm thay đổi cơ sở dữ liệu, triển khai từ xa hoặc tạo dữ liệu mẫu. Hợp đồng chi tiết cho năm thao tác sẽ được xác định ở bước lập kế hoạch theo quy ước dự án.
