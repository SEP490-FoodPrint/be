# Feature Specification: Mã nghiệp vụ FP thống nhất mã hóa bằng Feistel permutation

**Feature Branch**: `refactor/feistel-business-codes`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "tôi muốn refactor lại phần code của những phần liên quan tôi đã nói ở trên, feistel permutation thì tạo 1 hàm để cho các phần dùng chung" — các phần liên quan là những bảng danh sách nghiệp vụ theo nguyên tắc VII của hiến chương: hồ sơ đăng ký, đơn giao nguyên liệu, khiếu nại, yêu cầu hỗ trợ, đơn xử lý sự cố; mỗi bản ghi có mã riêng bên cạnh id, cú pháp FP + 2 ký tự viết tắt tính năng + 5 chữ số, 5 chữ số là số thứ tự được mã hóa bằng Feistel permutation.

## Bối cảnh hiện trạng

| Danh sách nghiệp vụ               | Bản ghi                     | Mã hiện có                                                              | Cách sinh hiện tại                                                                             |
| --------------------------------- | --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Hồ sơ đăng ký đơn vị              | Hồ sơ đăng ký               | `FP-REG-00001`, hiển thị từ số hồ sơ tự tăng, không lưu thành trường mã | Số tuần tự, 3 ký tự viết tắt                                                                   |
| Đơn giao nguyên liệu              | Chuyến giao hàng            | `FP-DE-00001`, lưu ở trường số chuyến giao                              | Số tuần tự; mã đã in trên trang truy xuất công khai và nằm trong dữ liệu chứng thực blockchain |
| Khiếu nại chất lượng nguyên liệu  | Khiếu nại nguyên liệu       | `FP-CP-00001`, lưu ở trường mã khiếu nại                                | Số tuần tự                                                                                     |
| Khiếu nại bữa ăn                  | Khiếu nại bữa ăn            | Chưa có                                                                 | —                                                                                              |
| Đơn xử lý sự cố an toàn thực phẩm | Sự cố                       | Chưa có                                                                 | —                                                                                              |
| Yêu cầu hỗ trợ                    | Chưa tồn tại trong hệ thống | —                                                                       | —                                                                                              |

Mỗi loại mã hiện có một bộ định dạng/đọc mã riêng với độ dài và giới hạn khác nhau.

## Clarifications

### Session 2026-11-19

- Q: Mã đã cấp trước thay đổi xử lý thế nào? → A: Giữ nguyên mã cũ, chỉ mã cấp mới dùng Feistel; mã mới trùng mã cũ thì bỏ qua số thứ tự đó.
- Q: Chữ viết tắt 2 ký tự cho hồ sơ đăng ký? → A: `RG` (`FP-RG-`); hồ sơ cũ giữ mã `FP-REG-` đang hiển thị.
- Q: Chữ viết tắt cho khiếu nại bữa ăn và sự cố an toàn thực phẩm? → A: `MC` cho khiếu nại bữa ăn, `IC` cho sự cố.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Mã mới không lộ thứ tự và số lượng bản ghi (Priority: P1)

Là người vận hành hệ thống, tôi muốn mã của các bản ghi nghiệp vụ mới tạo không phải là số đếm tăng dần, để người ngoài nhìn mã (ví dụ trên tem QR công khai hoặc email) không suy ra được số lượng hồ sơ, chuyến giao hay khiếu nại của hệ thống và không đoán được mã của bản ghi khác.

**Why this priority**: Đây là mục tiêu chính của thay đổi và là yêu cầu của nguyên tắc VII hiến chương.

**Independent Test**: Tạo liên tiếp nhiều bản ghi cùng loại và kiểm tra các mã nhận được đúng cú pháp, không trùng, không tăng dần liên tiếp.

**Acceptance Scenarios**:

1. **Given** hệ thống đã cấp mã cho một số bản ghi của một loại, **When** người dùng tạo thêm 3 bản ghi liên tiếp cùng loại, **Then** mỗi bản ghi nhận mã dạng `FP-<XX>-<5 chữ số>` khác nhau và phần số của chúng không phải là các số liên tiếp.
2. **Given** hai người dùng tạo bản ghi cùng loại vào cùng một thời điểm, **When** cả hai thao tác thành công, **Then** hai bản ghi có mã khác nhau.
3. **Given** một bản ghi đã có mã, **When** bản ghi được đọc lại, sửa nội dung hoặc chuyển trạng thái, **Then** mã giữ nguyên.
4. **Given** thao tác tạo bản ghi thất bại và bị hoàn tác, **When** người dùng tạo lại, **Then** không có hai bản ghi tồn tại nào dùng chung mã.

---

### User Story 2 - Một cách sinh và đọc mã dùng chung cho mọi loại (Priority: P1)

Là lập trình viên, tôi muốn mọi loại mã nghiệp vụ dùng chung một chức năng mã hóa Feistel và một cơ chế định dạng/đọc mã, thay cho các bộ sinh mã riêng lẻ hiện nay, để thêm loại mã mới chỉ cần đăng ký chữ viết tắt.

**Why this priority**: Đây là phần refactor người dùng yêu cầu trực tiếp; giảm trùng lặp và bảo đảm mọi loại mã tuân thủ cùng một quy tắc.

**Independent Test**: Kiểm tra chức năng mã hóa dùng chung độc lập (không cần cơ sở dữ liệu): với cùng khóa, mọi giá trị đầu vào trong miền cho ra giá trị khác nhau trong miền và giải ngược được về đúng đầu vào.

**Acceptance Scenarios**:

1. **Given** một khóa cố định, **When** mã hóa toàn bộ các giá trị từ 0 đến 99999, **Then** nhận đúng 100.000 kết quả khác nhau, tất cả nằm trong 0–99999, và giải mã mỗi kết quả trả lại đúng giá trị ban đầu.
2. **Given** hai khóa khác nhau, **When** mã hóa cùng một số thứ tự, **Then** kết quả nói chung khác nhau.
3. **Given** mọi loại mã trong phạm vi, **When** hệ thống cấp mã mới, **Then** tất cả đều đi qua cùng một chức năng mã hóa và cùng quy tắc định dạng, chỉ khác chữ viết tắt.
4. **Given** một chuỗi người dùng nhập vào ô tìm kiếm, **When** chuỗi đó là mã đúng cú pháp của loại tương ứng, **Then** hệ thống nhận diện là tìm theo mã; chuỗi khác được giữ là tìm theo tên như hiện nay.

---

### User Story 3 - Bổ sung mã cho các danh sách chưa có mã (Priority: P2)

Là Ban Giám hiệu hoặc người xử lý, tôi muốn khiếu nại bữa ăn và đơn xử lý sự cố cũng có mã nghiệp vụ như các danh sách khác, để trao đổi và tra cứu bằng mã thay vì định danh kỹ thuật.

**Why this priority**: Hoàn thiện phạm vi của nguyên tắc VII; phụ thuộc vào chức năng dùng chung ở User Story 2.

**Independent Test**: Tạo khiếu nại bữa ăn và sự cố mới, kiểm tra danh sách/chi tiết trả về mã đúng cú pháp bên cạnh id; kiểm tra bản ghi cũ cũng đã được cấp mã.

**Acceptance Scenarios**:

1. **Given** người dùng tạo một khiếu nại bữa ăn hoặc một sự cố mới, **When** tạo thành công, **Then** bản ghi có mã riêng đúng cú pháp, id không đổi và vẫn được dùng trong đường dẫn.
2. **Given** các khiếu nại bữa ăn và sự cố đã tồn tại trước thay đổi, **When** thay đổi được triển khai, **Then** mỗi bản ghi cũ đều được cấp một mã duy nhất, không bản ghi nào bị bỏ trống mã.
3. **Given** danh sách khiếu nại bữa ăn hoặc sự cố, **When** người dùng xem danh sách và chi tiết, **Then** thấy mã của từng bản ghi.

---

### Edge Cases

- Mã mới sinh ra trùng với một mã đã cấp theo cách cũ (số tuần tự): hệ thống bỏ qua số thứ tự đó và lấy số kế tiếp cho tới khi được mã chưa tồn tại; không bao giờ ghi đè hoặc cấp trùng.
- Mã có phần số `00000` không được cấp (giữ tương thích với quy tắc mã cũ coi `00000` là không hợp lệ); số thứ tự cho ra `00000` được bỏ qua như trường hợp trùng.
- Một loại mã đã dùng hết dải giá trị (100.000 số thứ tự, tối đa 99.999 mã dùng được): thao tác tạo bản ghi bị từ chối với thông báo lỗi rõ ràng bằng tiếng Việt; không quay vòng, không tự tăng thêm chữ số.
- Thiếu khóa mã hóa trong cấu hình hoặc khóa không hợp lệ: hệ thống không cấp mã (báo lỗi rõ ràng) thay vì sinh mã bằng khóa mặc định.
- Mã cũ có hơn 5 chữ số hoặc mã cũ dạng khác (ví dụ `FP-REG-...`) vẫn đọc và tìm kiếm được như trước.
- Tạo nhiều bản ghi trong một thao tác (ví dụ nhiều chuyến giao cùng lúc): mỗi bản ghi nhận một mã riêng, không trùng.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp một chức năng mã hóa Feistel dùng chung, có khóa, là hoán vị một-một trên miền 0–99999 (mọi kết quả nằm trong miền), có chức năng giải ngược tương ứng; mọi loại mã nghiệp vụ trong phạm vi MUST dùng chức năng này.
- **FR-002a**: Phần 5 chữ số sau tiền tố `FP-<XX>-` của mọi mã cấp mới MUST là kết quả ánh xạ số thứ tự của loại mã qua Feistel permutation (số thứ tự thứ s cho phần số = Feistel(s − 1), viết đủ 5 chữ số); không loại mã nào trong phạm vi được dùng số thứ tự thô làm hậu tố.
- **FR-002**: Hệ thống MUST cung cấp một cơ chế định dạng và đọc mã dùng chung theo cú pháp `FP-<XX>-<NNNNN>` (tiền tố FP, 2 chữ in hoa viết tắt tính năng, đúng 5 chữ số), thay cho các bộ định dạng riêng của từng loại mã trong phạm vi.
- **FR-003**: Mỗi chữ viết tắt MUST được đăng ký đúng một lần trong danh mục dùng chung; hai loại mã không được dùng chung chữ viết tắt.
- **FR-004**: Hệ thống MUST lưu bền vững số thứ tự đã cấp cho từng loại mã và cấp số kế tiếp trong cùng giao dịch tạo bản ghi, sao cho các thao tác tạo đồng thời không nhận cùng số thứ tự.
- **FR-005**: Mã MUST được cấp một lần khi tạo bản ghi, có ràng buộc duy nhất trong cơ sở dữ liệu (riêng chuyến giao: dữ liệu cũ đã trùng mã giữa các nhà cung cấp nên ràng buộc vẫn theo từng nhà cung cấp; mã cấp mới được kiểm tra không trùng trên toàn hệ thống trước khi lưu), không thay đổi khi bản ghi được sửa hoặc chuyển trạng thái và không được tái sử dụng.
- **FR-006**: Khi mã sinh ra trùng với mã đã tồn tại của cùng loại, hệ thống MUST bỏ qua số thứ tự đó và thử số kế tiếp.
- **FR-007**: Khi một loại mã hết dải 100.000 số thứ tự, hệ thống MUST từ chối cấp mã với lỗi rõ ràng, không quay vòng và không nới định dạng.
- **FR-008**: Khóa mã hóa MUST được lấy từ cấu hình môi trường, không nằm trong mã nguồn hay phản hồi API; thiếu hoặc sai định dạng khóa MUST làm thao tác cấp mã thất bại rõ ràng.
- **FR-009**: Các mã đã cấp trước thay đổi (chuyến giao, khiếu nại nguyên liệu, hồ sơ đăng ký) MUST được giữ nguyên; chỉ mã cấp mới sau thay đổi đi qua Feistel. Mã cũ tiếp tục hiển thị, tra cứu và khớp với tem QR đã in, email đã gửi và dữ liệu chứng thực blockchain.
- **FR-010**: Hồ sơ đăng ký MUST có trường mã riêng theo cú pháp chung với chữ viết tắt `RG` (`FP-RG-NNNNN`) cho hồ sơ tạo mới. Hồ sơ đã tồn tại được lưu vào trường mã đúng giá trị `FP-REG-NNNNN` đang hiển thị (theo FR-009) và vẫn tìm được bằng mã đó.
- **FR-011**: Khiếu nại bữa ăn và đơn xử lý sự cố MUST có trường mã riêng bên cạnh id, được cấp cho cả bản ghi mới và bản ghi đã tồn tại, với chữ viết tắt `MC` cho khiếu nại bữa ăn (`FP-MC-NNNNN`) và `IC` cho sự cố an toàn thực phẩm (`FP-IC-NNNNN`). Bản ghi đã tồn tại chưa có mã được cấp mã mới qua Feistel.
- **FR-012**: Danh sách và chi tiết hiện có của các bản ghi trong phạm vi MUST trả về mã bên cạnh id (sự cố an toàn thực phẩm chưa có danh sách/chi tiết nên trả mã khi các API đó được xây dựng); id vẫn là định danh dùng trong đường dẫn và quan hệ dữ liệu.
- **FR-013**: Tìm kiếm hồ sơ đăng ký theo mã (chức năng tìm kiếm theo mã duy nhất hiện có) MUST hoạt động với cả mã cũ `FP-REG-…` và mã mới `FP-RG-…`, không phân biệt hoa thường; feature này không thêm tìm kiếm theo mã cho các danh sách khác.
- **FR-014**: Hợp đồng phản hồi hiện có (tên trường, envelope, phạm vi phân quyền theo tổ chức) MUST giữ nguyên ngoài việc bổ sung trường mã cho các danh sách chưa có mã.

### Ngoài phạm vi

- Yêu cầu hỗ trợ: chưa có trong hệ thống; khi được xây dựng sẽ dùng cơ chế chung này theo spec riêng.
- Các mã không phải danh sách nghiệp vụ trong yêu cầu (lô nguyên liệu `LO`, lô nấu `CB`, nhóm lô nấu `BG`, tủ lưu mẫu `SU`, cơ sở nguồn cung `SF`) và số yêu cầu cung ứng do người dùng nhập: giữ nguyên cách sinh hiện tại.
- Đổi tên các trường mã đã có trong cơ sở dữ liệu (trường số chuyến giao, trường mã khiếu nại nguyên liệu).

### Key Entities

- **Loại mã nghiệp vụ**: một danh sách nghiệp vụ được cấp mã, xác định bởi chữ viết tắt 2 ký tự; mỗi loại có dải 100.000 số thứ tự riêng.
- **Bộ đếm số thứ tự theo loại mã**: số thứ tự cuối cùng đã cấp cho mỗi loại mã, dùng làm đầu vào cho mã hóa.
- **Mã nghiệp vụ**: chuỗi `FP-<XX>-<NNNNN>` gắn với một bản ghi, duy nhất trong loại, bất biến.
- **Khóa mã hóa**: bí mật cấu hình dùng chung cho chức năng Feistel; không đổi sau khi đã phát hành mã.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% mã cấp mới của các loại trong phạm vi đúng cú pháp `FP-<XX>-<5 chữ số>`, không trùng trong cùng loại, kể cả khi 20 thao tác tạo diễn ra đồng thời.
- **SC-002**: Trong 1.000 mã cấp liên tiếp của cùng một loại, không có cặp mã kế tiếp nào có phần số liên tiếp nhau.
- **SC-003**: Kiểm thử toàn miền 0–99999 cho chức năng mã hóa dùng chung cho đúng 100.000 kết quả khác nhau và giải ngược đúng 100%.
- **SC-004**: Chỉ còn một nơi định nghĩa cách mã hóa và một nơi định nghĩa cú pháp mã cho mọi loại trong phạm vi; thêm một loại mã mới chỉ cần đăng ký chữ viết tắt.
- **SC-005**: Sau khi triển khai và chạy bước gán mã cho dữ liệu cũ trên môi trường đó, 100% khiếu nại bữa ăn và sự cố (cả cũ và mới) có mã; mọi mã đã in hoặc đã gửi trước đó vẫn tra cứu được.

## Assumptions

- "Đơn giao nguyên liệu" là chuyến giao hàng; trường số chuyến giao hiện có chính là trường mã của bản ghi, không tạo thêm trường mới hay đổi tên.
- "Khiếu nại" gồm khiếu nại chất lượng nguyên liệu (đã có mã `CP`) và khiếu nại bữa ăn (chưa có mã); "đơn xử lý sự cố" là sự cố an toàn thực phẩm.
- Dùng cú pháp có gạch ngang `FP-XX-NNNNN` theo quy ước hiện có của hệ thống.
- Bản ghi cũ chưa có mã được cấp mã qua migration có kiểm duyệt; việc chạy migration trên Azure đi theo quy trình CD đã duyệt.
- Khóa mã hóa do người vận hành cấu hình riêng cho từng môi trường; môi trường kiểm thử dùng khóa riêng.
- Phân quyền và phạm vi tổ chức của các danh sách giữ nguyên.
