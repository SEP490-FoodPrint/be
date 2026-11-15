# Feature Specification: Tạo đơn giao hàng có nguồn cung và QR truy xuất

**Feature Branch**: `feat/supplier-order-creation-traceability`

**Created**: 2026-11-14

**Updated**: 2026-11-15

**Status**: Tasked — bản sửa đổi nguồn cung/QR và vòng đời giao hàng; đã có kế hoạch và tasks, chưa triển khai

**Input**: User description: "Nếu có yêu cầu từ nhà trường thì tạo đơn dựa trên yêu cầu; nguyên liệu trong đơn phải gắn với một cơ sở nguồn cung và mỗi nguyên liệu trong đơn có một QR để dán bao bì; mã đơn FP-DE-00001; biển số xe và thời gian giao dự kiến bắt buộc; tạo xong là đang giao hàng; đủ các vai trò kiểm tra đạt mới hoàn thành; không đạt thì yêu cầu giao lại và nhà cung cấp tạo đơn thủ công."

**Amendment scope**: Cập nhật spec đã có, giữ lịch sử quyết định bên dưới. Các yêu cầu hiện hành trong phần User Scenarios, Requirements và Success Criteria thay thế quy tắc cũ về trạng thái mới tạo, thông tin giao hàng tùy chọn và mã đơn chưa quy định định dạng. Plan/research/data-model/contracts/quickstart đã được cập nhật theo bản sửa đổi; 58 task amendment T041–T098 ở tasks.md đều chưa thực hiện; tasks-baseline.md giữ nguyên lịch sử cũ, chưa phải triển khai của yêu cầu mới.

## Clarifications

### Session 2026-11-15

- Q: Nhà cung cấp chỉ tạo đơn từ yêu cầu đã tiếp nhận hay có thể tạo độc lập? → A: Hỗ trợ cả hai cách: tạo từ yêu cầu đã tiếp nhận và tạo độc lập không bắt buộc có yêu cầu nguồn.
- Q: Một yêu cầu được tạo một đơn toàn bộ hay chia nhiều đơn từng phần? → A: Q2 = A, một yêu cầu tạo một đơn chứa toàn bộ nguyên liệu và đúng toàn bộ số lượng yêu cầu; không chia đơn từ yêu cầu thành từng phần.
- Q: Nhu cầu đơn độc lập phát sinh từ đâu? → A: Phát sinh khi đơn giao trước bị yêu cầu giao lại; đây là mục đích sử dụng, không tự biến lịch sử từ chối thành điều kiện bắt buộc để tạo đơn độc lập.
- Q: Có chuyển cơ chế đơn độc lập thành chỉ tạo phiếu thay thế từ đơn bị từ chối không? → A: Giữ nguyên cơ chế tạo đơn độc lập; không bắt buộc liên kết yêu cầu nguyên liệu hoặc phiếu giao trước. Các giới hạn một phiếu thay thế cho một lần từ chối không áp vào cơ chế này.
- Q: Đơn độc lập có bắt buộc bên nhận không và chọn từ đâu? → A: Có. Bắt buộc chọn một trường mà nhà cung cấp đã liên kết. Từ “nguồn cung” trong câu trả lời này chỉ trường được chọn làm bên nhận, không phải cơ sở nguồn cung nguyên liệu.

### Amendment 2026-11-15 — Nguồn cung, QR và giao hàng

- Yêu cầu mới xác nhận mỗi dòng nguyên liệu của đơn phải chọn đúng một cơ sở nguồn cung, có một QR riêng cho dòng đó, bắt buộc biển số xe/thời gian giao dự kiến, và tạo thành công chuyển ngay sang đang giao hàng.
- Q1: Mã `FP-DE-00001` tăng chung hay theo nhà cung cấp? → A: B — mỗi nhà cung cấp có dãy riêng, đều bắt đầu `FP-DE-00001`. Mã hiển thị có thể trùng giữa các nhà cung cấp.
- Q2: Ai được xem khi quét QR? → A: B — ai có QR đều xem được thông tin truy xuất công khai có giới hạn, không bắt buộc đăng nhập.
- Q3: Có giữ quy tắc lần từ chối thứ ba hủy yêu cầu và các đợt chưa nhận? → A: A — giữ giới hạn hiện hành; đơn thủ công vẫn độc lập như đã chốt, không tự liên kết hoặc đặt lại chuỗi giao lại cũ.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Tạo đơn từ yêu cầu đã tiếp nhận (Priority: P1)

Là admin hoặc staff nhà cung cấp có quyền phù hợp, tôi muốn tạo một đơn giao hàng chứa toàn bộ nội dung yêu cầu đã tiếp nhận để thực hiện cung ứng cho trường.

**Why this priority**: Nối bước tiếp nhận với thực hiện đơn, tránh nhập lại hoặc thay sai đối tác, nguyên liệu và số lượng.

**Independent Test**: Dùng cả hai vai trò tạo từ hai yêu cầu khác nhau; đối chiếu đủ dòng và đúng số lượng gốc, rồi thử tạo đơn thứ hai cho cùng yêu cầu.

**Acceptance Scenarios**:

1. **Given** yêu cầu đã tiếp nhận thuộc nhà cung cấp mình và chưa được dùng tạo đơn, **When** tạo đơn từ yêu cầu, **Then** trường nhận, nhà cung cấp và toàn bộ nguyên liệu/số lượng/đơn vị được kế thừa từ yêu cầu đã lưu.
2. **Given** nội dung hợp lệ, mỗi dòng có cơ sở nguồn cung và đã nhập biển số xe/thời gian giao dự kiến, **When** xác nhận, **Then** tạo một đơn có mã `FP-DE-…` riêng trong nhà cung cấp, trạng thái đang giao hàng, một QR cho mỗi dòng, người/thời điểm tạo và liên kết yêu cầu gốc; yêu cầu chuyển từ đã tiếp nhận sang đang thực hiện trong cùng thao tác.
3. **Given** người dùng bỏ dòng, đổi nguyên liệu/đơn vị hoặc thay lượng so với yêu cầu, **When** xác nhận, **Then** bị từ chối và không tạo đơn sai hoặc thiếu nội dung.
4. **Given** yêu cầu đã có đơn, **When** cố tạo thêm đơn từ cùng yêu cầu, **Then** bị chặn; gửi lại cùng thao tác phải nhận diện được kết quả đã tạo.
5. **Given** yêu cầu chưa tiếp nhận, đã hoàn thành hoặc đã hủy, **When** tạo từ yêu cầu, **Then** bị từ chối và không thay đổi dữ liệu.
6. **Given** yêu cầu ngoài nhà cung cấp hoặc không tồn tại, **When** tạo đơn, **Then** trả cùng loại thông báo không tìm thấy.
7. **Given** nội dung nguyên liệu được kế thừa từ yêu cầu, **When** chọn nguồn cung cho từng dòng, **Then** được bổ sung nguồn cung nhưng không đổi nguyên liệu, số lượng, đơn vị hoặc bỏ dòng nguồn.
8. **Given** thiếu nguồn cung của bất kỳ dòng nào, thiếu biển số xe hoặc thời gian giao dự kiến, **When** xác nhận, **Then** báo lỗi tương ứng và không tạo đơn thiếu thông tin.

---

### User Story 2 - Tạo đơn độc lập cho trường đã liên kết (Priority: P1)

Là admin hoặc staff nhà cung cấp có quyền phù hợp, tôi muốn chọn một trường đã liên kết, chọn nguyên liệu và nhập số lượng để tạo đơn độc lập, kể cả khi cần chủ động giao lại mà không có yêu cầu mới từ trường.

**Why this priority**: Cho phép nhà cung cấp chủ động lập đơn theo nhu cầu thực tế mà vẫn xác định đúng trường nhận và quyền sở hữu nguyên liệu.

**Independent Test**: Khi không có yêu cầu nguyên liệu hoặc phiếu bị từ chối làm nguồn, dùng cả hai vai trò tạo đơn cho trường đã liên kết; thử bỏ trường nhận, chọn trường chưa liên kết và chọn nguyên liệu của nhà cung cấp khác.

**Acceptance Scenarios**:

1. **Given** nhà cung cấp có trường đã liên kết đủ điều kiện cung ứng hiện hành, **When** chọn tạo độc lập, **Then** người dùng phải chọn một trường từ danh sách đó; không bắt buộc chọn yêu cầu nguyên liệu hay phiếu giao trước.
2. **Given** đã chọn trường hợp lệ, nguyên liệu thuộc nhà cung cấp, số lượng/đơn vị hợp lệ, nguồn cung cho từng dòng và đủ thông tin giao hàng, **When** xác nhận, **Then** tạo đơn độc lập có mã `FP-DE-…`, trạng thái đang giao hàng, QR cho từng dòng và người/thời điểm tạo; không tạo yêu cầu nhà trường giả hoặc sửa một yêu cầu không liên quan.
3. **Given** không chọn trường hoặc chọn trường chưa liên kết/không còn được phép cung ứng, **When** xác nhận, **Then** bị từ chối và không tạo đơn.
4. **Given** nguyên liệu ngoài phạm vi, dòng trùng, đơn rỗng hoặc số lượng không dương, **When** xác nhận, **Then** báo rõ nội dung sai và không lưu đơn dở dang.
5. **Given** không có yêu cầu nguyên liệu hoặc lịch sử giao bị từ chối, **When** tạo độc lập với nội dung hợp lệ, **Then** vẫn tạo thành công.
6. **Given** người dùng có ý định lập hai đơn độc lập riêng biệt có cùng trường/nguyên liệu, **When** xác nhận từng thao tác, **Then** không bị giới hạn một đơn do quy tắc Q2; chỉ thao tác gửi lại cùng lần tạo mới phải chống trùng.

---

### User Story 3 - Xem lại kết quả và tránh tạo trùng (Priority: P2)

Là admin hoặc staff có quyền xem, tôi muốn xem đơn đã tạo, phân biệt đơn từ yêu cầu với đơn độc lập và tránh bản sao khi thao tác được gửi lại.

**Why this priority**: Xác định được kết quả tạo và nguồn đơn giúp xử lý đúng việc khi kết nối gián đoạn hoặc nhiều nhân viên cùng thao tác.

**Independent Test**: Tạo đơn theo cả hai cách, xem danh sách/chi tiết bằng hai vai trò, thử gửi lại và thử hai người cùng tạo từ một yêu cầu.

**Acceptance Scenarios**:

1. **Given** có đơn theo cả hai cách, **When** xem danh sách hoặc chi tiết, **Then** thấy cách tạo, nhà cung cấp và mã/trạng thái, trường nhận, thông tin giao hàng, người/thời điểm tạo; chi tiết có dòng nguyên liệu/lượng/đơn vị, nguồn cung và QR; liên kết yêu cầu chỉ có ở đơn từ yêu cầu.
2. **Given** thao tác đã tạo thành công nhưng người dùng chưa nhận kết quả, **When** gửi lại cùng thao tác, **Then** không tạo thêm bản sao, không cấp mã đơn hoặc QR mới và xác định được kết quả đã có.
3. **Given** hai người cùng tạo từ một yêu cầu, **When** ghi nhận kết quả, **Then** chỉ có một đơn liên kết yêu cầu đó, không lưu thiếu dòng hoặc thiếu nguồn.
4. **Given** người dùng không có quyền xem hoặc thuộc nhà cung cấp khác, **When** xem đơn, **Then** bị chặn theo quyền/phạm vi hiện hành.
5. **Given** hai nhà cung cấp cùng có mã `FP-DE-00001`, **When** xem đơn hoặc quét QR của một dòng, **Then** xác định đúng nhà cung cấp, đơn và dòng tương ứng; không nhầm vì chỉ dựa vào mã hiển thị.

---

### User Story 4 - Chọn nguồn cung và lấy QR dán bao bì (Priority: P1)

Là admin hoặc staff nhà cung cấp đủ quyền tạo đơn, tôi muốn chọn nguồn cung cho từng nguyên liệu và lấy nhãn QR để bên nhận tra cứu đúng xuất xứ của hàng được giao.

**Why this priority**: Nối nguyên liệu trong đơn với cơ sở thực tế, giúp kiểm tra nguồn gốc khi hàng đến trường.

**Independent Test**: Tạo đơn có ba dòng dùng hai cơ sở, lấy và quét ba QR bằng thiết bị chưa đăng nhập, đối chiếu đúng từng dòng và thử in lại nhãn.

**Acceptance Scenarios**:

1. **Given** nhà cung cấp có các cơ sở đang hoạt động, **When** chọn nguồn cho từng dòng của đơn từ yêu cầu hoặc đơn thủ công, **Then** mỗi dòng phải chọn đúng một cơ sở của nhà cung cấp đó; nhiều dòng được dùng chung một cơ sở.
2. **Given** cơ sở của nhà cung cấp khác, đã dừng hoặc không tồn tại, **When** chọn để tạo đơn mới, **Then** không được chấp nhận; staff đủ quyền tạo đơn được chọn cơ sở nhưng không vì vậy có quyền quản trị cơ sở.
3. **Given** đơn có ba dòng được tạo thành công, **When** lấy nhãn, **Then** có đúng ba QR riêng biệt kèm mã đơn, tên nguyên liệu và tên/mã cơ sở để phân biệt nhãn khi dán bao bì.
4. **Given** một QR hợp lệ, **When** người bất kỳ quét mà chưa đăng nhập, **Then** xem được nhà cung cấp, mã/trạng thái đơn, nguyên liệu, số lượng/đơn vị và tên/mã cơ sở của đúng dòng; không xem được toàn bộ đơn hoặc thông tin riêng tư của đối tác/tài khoản.
5. **Given** nhãn cần in lại hoặc cùng nguyên liệu xuất hiện trong một đơn khác, **When** lấy nhãn, **Then** in lại dùng cùng QR của dòng cũ; dòng ở đơn khác có QR khác.
6. **Given** cơ sở đổi tên hoặc dừng sau khi giao, **When** quét lại QR cũ, **Then** vẫn xác định nguồn đã được ghi nhận lúc tạo; không chuyển QR sang nguồn khác hoặc làm mất lịch sử.
7. **Given** QR sai hoặc tham chiếu không tồn tại, **When** tra cứu, **Then** báo không tìm thấy thông tin truy xuất và không trả dữ liệu của dòng khác.

---

### User Story 5 - Kiểm nhận để hoàn thành hoặc yêu cầu giao lại (Priority: P1)

Là một bên kiểm nhận của trường, tôi muốn ghi nhận kết quả kiểm tra để đơn chỉ hoàn thành khi tất cả các bên bắt buộc đều xác nhận đạt; khi không đạt, nhà cung cấp biết lý do để lập đơn thủ công giao lại.

**Why this priority**: Tách việc nhà cung cấp bắt đầu giao với việc trường đã nhận đạt, bảo toàn các quyết định kiểm tra và lịch sử kho.

**Independent Test**: Dùng bốn vai trò kiểm nhận thực hiện các tổ hợp đạt/không đạt trên các đơn khác nhau; thử quyết định cuối đồng thời, rồi lập đơn thủ công sau một lần bị từ chối.

**Acceptance Scenarios**:

1. **Given** đơn vừa được tạo, **When** xem kết quả, **Then** trạng thái là đang giao hàng, chưa được coi là hoàn thành hoặc đã nhập kho.
2. **Given** hàng đã đến trường và đủ điều kiện kiểm nhận, **When** chưa đủ cả bốn vai trò xác nhận đạt, **Then** đơn chưa hoàn thành; quét QR không tự ghi quyết định kiểm nhận.
3. **Given** chưa có quyết định không đạt và ba vai trò đã xác nhận đạt, **When** vai trò còn lại xác nhận đạt và việc nhận hàng hợp lệ được ghi nhận, **Then** đơn hoàn thành, các lô/kho được ghi nhận đúng một lần; áp dụng cho cả hai cách tạo đơn.
4. **Given** đơn đang được kiểm nhận, **When** một vai trò đủ quyền ghi không đạt kèm lý do, **Then** đơn hiển thị yêu cầu giao hàng lại, không nhập kho theo đơn đó; những xác nhận đạt đến sau không đảo ngược quyết định không đạt.
5. **Given** đơn yêu cầu giao lại, **When** nhà cung cấp tạo đơn thủ công, **Then** nhập trường liên kết, nguyên liệu, nguồn cung, số lượng và thông tin giao hàng theo quy tắc của đơn độc lập; đơn mới có mã/QR mới, bắt đầu đang giao hàng và cần kiểm nhận mới từ đầu.
6. **Given** đơn cũ có lịch sử kiểm nhận, **When** tạo đơn thủ công mới, **Then** đơn cũ và quyết định cũ được giữ nguyên; không chuyển chữ ký, khôi phục yêu cầu đã hủy hoặc đặt lại số lần từ chối của yêu cầu cũ.
7. **Given** cùng yêu cầu đã có hai đợt bị từ chối, **When** đợt thứ ba bị từ chối, **Then** vẫn hủy yêu cầu và các đợt chưa nhận theo chính sách hiện hành; không thay đổi đợt đã nhận hoặc kho đã ghi.
8. **Given** nhiều người đồng thời gửi quyết định cuối hoặc gửi lại quyết định, **When** xử lý kết quả, **Then** mỗi vai trò có tối đa một quyết định bất biến cho một đơn và việc hoàn thành/nhập kho chỉ xảy ra một lần.

### Edge Cases

- Không có yêu cầu nguồn không ngăn tạo độc lập; thiếu trường nhận hoặc trường không thuộc tập đã liên kết hợp lệ phải ngăn tạo độc lập.
- Danh sách trường liên kết rỗng: hiển thị không có trường phù hợp và không cho xác nhận tạo độc lập.
- Trường liên kết hợp lệ khi mở form nhưng quan hệ đổi trước khi ghi nhận: xác minh lại và từ chối nếu không còn được phép tạo độc lập.
- Nhà cung cấp luôn lấy từ tài khoản hiện hành; không cho giả mạo tổ chức hoặc chọn nguyên liệu thuộc đơn vị khác.
- Đơn từ yêu cầu phải giữ nguyên trường, toàn bộ nguyên liệu/số lượng/đơn vị nguồn; đơn độc lập không bị giới hạn lượng bởi một yêu cầu không liên quan.
- Quyền, membership hoặc trạng thái nguồn thay đổi trong lúc tạo: kiểm tra lại trước khi ghi; lỗi giữa chừng không để lại đơn thiếu dòng.
- Tạo độc lập để giao lại không tự sửa đơn cũ, xóa quyết định kiểm nhận, khôi phục yêu cầu bị hủy hoặc đặt lại bộ đếm của yêu cầu cũ.
- Tạo đơn chưa tự xác nhận đến nơi, được duyệt, trường đã nhận hoặc làm thay đổi tồn kho.
- Hai người tạo đồng thời phải không trùng mã trong cùng nhà cung cấp; hai nhà cung cấp được dùng cùng số thứ tự. Dãy vượt 99999 vẫn giữ đủ chữ số; không quay về đầu hoặc tái sử dụng mã đã cấp.
- Cùng một nguyên liệu ở hai đơn hoặc hai nhà cung cấp có cùng mã hiển thị vẫn có QR phân biệt được từng dòng; in nhiều nhãn cho cùng dòng không sinh định danh bao bì mới.
- Thiếu, rỗng hoặc chỉ có khoảng trắng ở biển số xe; thời gian thiếu, không hợp lệ hoặc không xác định được múi giờ đều phải bị chặn.
- Cơ sở hợp lệ khi chọn nhưng bị dừng/đổi chủ trước khi tạo: kiểm tra lại lúc ghi nhận và từ chối trọn vẹn.
- Cơ sở dừng sau khi đã tạo không tự hủy đơn đang giao, thay nguồn đã ghi nhận hoặc làm QR lịch sử mất hiệu lực.
- Chỉ còn ba bên đạt, một bên chưa kiểm hoặc không đạt: chưa được hoàn thành. Không được lấy chữ ký từ đơn giao lại khác để bù.
- Hết quyền quản lý đơn không làm mất chính sách công khai đã chọn cho QR; trang truy xuất chỉ đọc thông tin được công khai, không cho thao tác kiểm nhận hoặc duyệt đơn.
- Đơn cũ thiếu nguồn hoặc QR giữ dữ liệu lịch sử; không tự gán cơ sở ngẫu nhiên, sửa mã cũ hoặc coi là đáp ứng dữ liệu của đơn mới.
- Supplier tạm dừng nhận yêu cầu mới: xử lý đơn từ yêu cầu đã tiếp nhận theo chính sách công việc đã nhận; việc lập đơn độc lập kiểm tra điều kiện cung ứng mới và quyền hiện hành, không coi đó là cách bỏ qua tạm dừng.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cho admin và staff nhà cung cấp đang hoạt động, có membership hợp lệ và quyền tạo hiệu lực sử dụng hai cách tạo: từ yêu cầu đã tiếp nhận hoặc tạo độc lập. Quyền xem/tiếp nhận không tự thay thế quyền tạo.
- **FR-002**: Đơn từ yêu cầu MUST xuất phát từ yêu cầu đã tiếp nhận, còn được phép thực hiện và chưa được dùng tạo đơn. Không dùng yêu cầu chưa tiếp nhận, đã hoàn thành hoặc đã hủy. Đơn độc lập không bắt buộc có yêu cầu hoặc phiếu giao trước và không yêu cầu lịch sử bị từ chối.
- **FR-003**: Nhà cung cấp MUST được xác định từ tài khoản hiện hành. Đơn từ yêu cầu kế thừa trường nhận từ yêu cầu hợp lệ; đơn độc lập MUST chọn đúng một trường nhà cung cấp đã liên kết và được phép cung ứng theo chính sách quan hệ hiện hành. Không cho tự nhập bên nhận ngoài tập được phép.
- **FR-004**: Mỗi đơn MUST có định danh riêng, mã nghiệp vụ do hệ thống sinh theo FR-015, cách tạo, trạng thái, trường nhận và người/thời điểm tạo. Mã nghiệp vụ không được lấy từ hoặc cắt ngắn định danh ngẫu nhiên. Chỉ đơn từ yêu cầu bắt buộc liên kết yêu cầu gốc; không tạo yêu cầu nhà trường giả cho đơn độc lập.
- **FR-005**: Đơn từ yêu cầu MUST chứa đủ toàn bộ dòng, giữ đúng nguyên liệu/đơn vị/toàn bộ số lượng nguồn, đồng thời cho bổ sung nguồn cung cho mỗi dòng. Đơn độc lập cho người tạo chọn nguyên liệu đang hoạt động của nhà cung cấp hiện hành, nhập số lượng dương và đơn vị hợp lệ; cả hai không cho đơn rỗng hoặc trùng nguyên liệu trong một đơn.
- **FR-006**: Cả hai cách tạo MUST yêu cầu biển số xe không rỗng và thời gian giao dự kiến hợp lệ, xác định được múi giờ; ghi chú là tùy chọn. Tạo thành công bắt đầu ngay ở trạng thái đang giao hàng. Không tự đánh dấu đến nơi, nhận đạt, hoàn thành hoặc nhập kho. Với đơn từ yêu cầu, chuyển yêu cầu đã tiếp nhận sang đang thực hiện trong cùng thao tác; yêu cầu đang thực hiện giữ trạng thái đó.
- **FR-007**: Một yêu cầu MUST chỉ tạo một đơn chứa toàn bộ nội dung theo Q2 = A; không chia đơn từng phần hoặc tạo thêm từ cùng yêu cầu. Quy tắc này chỉ áp dụng cho cách tạo từ yêu cầu, không giới hạn số đơn độc lập có ý định tạo riêng biệt.
- **FR-008**: Người có quyền xem trong nhà cung cấp MUST xem được danh sách phân trang và chi tiết cả hai cách tạo, nhận diện trường nhận và nguồn nếu có. Không trả dữ liệu ngoài phạm vi hoặc hồ sơ tài khoản nhạy cảm.
- **FR-009**: Tạo đơn, các dòng, nguồn cung, định danh truy xuất/QR, liên kết yêu cầu nếu có và thay đổi trạng thái liên quan MUST cùng thành công hoặc cùng thất bại. Chỉ báo tạo thành công khi mọi dòng có thể lấy được nhãn QR; không để lại đơn thiếu dòng/nguồn/QR. Đơn độc lập không tự làm thay đổi yêu cầu hoặc phiếu giao trước không liên quan.
- **FR-010**: Hệ thống MUST kiểm tra lại actor, role, quyền, membership và nội dung trước khi ghi nhận. Đơn từ yêu cầu kiểm tra lại trạng thái và giới hạn một đơn; đơn độc lập kiểm tra lại quan hệ với trường và quyền sở hữu nguyên liệu. Gửi lại cùng thao tác không tạo bản sao; tạo đồng thời từ cùng một yêu cầu không được sinh hai đơn.
- **FR-011**: Hệ thống MUST giữ phân quyền/cô lập tổ chức, điều kiện tiếp nhận và công việc đã nhận hiện hành. Tạo độc lập không tự sửa lịch sử kiểm nhận, nhập kho, yêu cầu đã hủy hoặc bộ đếm từ chối của đơn cũ. Tài khoản hệ thống hoặc nhà trường không có quyền ngầm tạo thay nhà cung cấp.
- **FR-012**: Hệ thống MUST báo lỗi tiếng Việt rõ ràng cho trường nhận, nguyên liệu, số lượng hoặc nguồn sai, thiếu quyền và xung đột trạng thái; không lộ nội dung ngoài phạm vi. Nguồn không tồn tại/ngoài phạm vi trả cùng loại thông báo không tìm thấy.
- **FR-013**: Nội dung đơn độc lập MUST do người tạo nhập từ danh mục nguyên liệu của nhà cung cấp và trường nhận đã liên kết. Không bắt buộc sao chép toàn bộ hoặc một phần phiếu bị từ chối. Nhu cầu giao lại là một trường hợp sử dụng cơ chế tạo độc lập; không tự thêm ràng buộc mỗi phiếu bị từ chối chỉ có một phiếu thay thế hoặc bắt buộc liên kết phiếu cũ.
- **FR-014**: Mỗi dòng nguyên liệu trong cả hai cách tạo MUST gắn đúng một cơ sở nguồn cung đang hoạt động thuộc nhà cung cấp hiện hành. Người tạo phải chọn nguồn cho từng dòng, không tự suy ra cơ sở từ nguyên liệu hoặc yêu cầu. Cho phép nhiều dòng dùng chung cơ sở; một dòng không chia nhiều cơ sở trong phạm vi này. Staff có quyền tạo đơn được xem lựa chọn nguồn đủ điều kiện mà không cần quyền thêm/sửa/dừng cơ sở. Phải xác minh lại cơ sở lúc ghi nhận; lô phát sinh từ dòng phải giữ đúng nguồn đã chọn.
- **FR-015**: Mã nghiệp vụ MUST có tiền tố `FP-DE-` và số nguyên dương tăng theo dãy riêng của từng nhà cung cấp, thêm số 0 bên trái cho đủ tối thiểu năm chữ số: `FP-DE-00001`, `FP-DE-00002`. Nhà cung cấp khác cũng bắt đầu `FP-DE-00001`; không dùng riêng mã hiển thị để xác định một đơn toàn hệ thống. Cấp mã đồng thời không trùng trong cùng nhà cung cấp; mã đã cấp giữ nguyên và không tái sử dụng khi bị từ chối/hủy. Cho phép khoảng trống, không yêu cầu liên tục; vượt 99999 giữ đủ chữ số. Người dùng không nhập/sửa mã và gửi lại cùng thao tác không cấp mã mới.
- **FR-016**: Mỗi dòng nguyên liệu của một đơn MUST có đúng một QR riêng để truy xuất dòng đó, phân biệt được dòng ở đơn khác dù trùng nguyên liệu/mã hiển thị. Nhà cung cấp đủ quyền có thể lấy nhãn để in và lấy lại cùng QR; không cấp QR mới khi in lại hoặc gửi lại thao tác tạo.
- **FR-017**: Ai có QR hợp lệ MUST có thể xem thông tin truy xuất công khai của đúng dòng mà không đăng nhập. Nội dung công khai chỉ gồm tên nhà cung cấp, mã/trạng thái đơn, tên nguyên liệu, số lượng/đơn vị, tên/mã cơ sở nguồn cung được ghi nhận khi tạo. Không công khai toàn bộ đơn, trường nhận, biển số xe, lịch giao, thông tin liên hệ cá nhân, tài khoản, hợp đồng, giá, chữ ký hoặc lịch sử kiểm nhận chi tiết. Không cho dò dòng khác chỉ bằng sửa mã đơn/mã cơ sở; QR sai trả thông báo không tìm thấy an toàn. Quét chỉ đọc, không cập nhật trạng thái/quyết định.
- **FR-018**: Nhãn cho mỗi dòng MUST có QR cùng mã đơn, tên nguyên liệu và tên/mã cơ sở để nhà cung cấp phân biệt khi dán bao bì. Có thể in nhiều bản của cùng nhãn; chưa quản lý định danh riêng cho từng bao/gói. Nội dung nguồn đã ghi nhận MUST tiếp tục truy xuất được khi cơ sở đổi tên hoặc dừng; không đổi nguồn trên đơn đã tạo hoặc gán lại QR sang dòng/đơn khác.
- **FR-019**: Đơn chỉ được kiểm nhận khi hàng đã đến trường theo điều kiện nghiệp vụ hiện hành. Cả bốn vai trò của trường nhận — cán bộ dinh dưỡng, nhân viên bếp, bộ phận quản lý nguyên liệu và ban phụ huynh — MUST có quyết định đạt trên đúng đơn trước khi có thể hoàn thành. Người kiểm cần quyền hiệu lực trong đúng trường; không thay thế vai trò bằng việc một người xác nhận nhiều lần. Một quyết định bất biến cho mỗi vai trò trên mỗi đơn; gửi lại đúng quyết định không nhân bản, quyết định khác hoặc người khác ký thay vai trò đã ghi phải bị chặn.
- **FR-020**: Đơn MUST chỉ chuyển hoàn thành sau khi đủ bốn vai trò kiểm tra đạt, không có quyết định không đạt và đáp ứng điều kiện nhận hàng/lô hiện hành. Hoàn thành và ghi nhận nhập kho phải nhất quán, xảy ra đúng một lần dù có thao tác đồng thời; không hiển thị hoàn thành nếu bước nhận hàng thất bại. Không bỏ qua các điều kiện về trường, nguồn, lượng, đơn vị, ngày hoặc lịch sử lô để hoàn thành.
- **FR-021**: Khi một vai trò kiểm nhận hợp lệ ghi không đạt kèm lý do, đơn MUST hiển thị yêu cầu giao hàng lại và lý do; không tự hoàn thành hoặc nhập kho, không cho các xác nhận đạt đến sau đảo ngược kết quả. Nhà cung cấp có thể dùng tạo thủ công theo FR-013 để giao lại bằng một đơn mới, mã mới và QR mới; đơn mới cần đủ bốn quyết định mới.
- **FR-022**: Quy tắc từ chối lần thứ ba trong cùng yêu cầu MUST tiếp tục hủy yêu cầu và các đợt chưa nhận như hiện hành, giữ các đợt đã nhận và lịch sử kho. Đơn thủ công không bắt buộc nối với yêu cầu/đơn cũ, không tự tính vào, đặt lại hoặc phục hồi chuỗi giao lại của yêu cầu cũ; dữ liệu chuỗi cũ và đơn độc lập phải được phân biệt rõ.
- **FR-023**: Danh sách/chi tiết trong phạm vi quản lý MUST thể hiện trạng thái giao hàng nhất quán với kết quả kiểm nhận, mã nghiệp vụ và nhà cung cấp tương ứng; chi tiết cung cấp nguồn/QR cho từng dòng và thông tin giao bắt buộc của đơn mới. Chỉ QR đã công khai được truy cập không đăng nhập; các màn quản lý/kiểm nhận vẫn tuân thủ quyền và tổ chức hiện hành.
- **FR-024**: Bổ sung các quy tắc mới MUST giữ nguyên định danh, mã hiện có, quyết định, lô và lịch sử kho của đơn cũ; không tự cấp nguồn không có căn cứ hoặc viết lại lịch sử thành đạt chuẩn đơn mới. Nhãn và trường bắt buộc mới áp dụng cho đơn tạo theo luồng sửa đổi; xử lý kỹ thuật cho dữ liệu cũ phải được thiết kế trước khi triển khai.

### Key Entities _(include if feature involves data)_

- **Yêu cầu nguyên liệu gốc**: Nguồn của cách tạo từ yêu cầu; xác định trường nhận và toàn bộ nguyên liệu/số lượng/đơn vị, tạo tối đa một đơn.
- **Đơn giao hàng**: Thuộc một nhà cung cấp, bắt buộc một trường nhận; có mã nghiệp vụ theo nhà cung cấp, biển số xe/thời gian giao dự kiến, hai cách tạo, trạng thái giao hàng và người/thời điểm tạo. Liên kết yêu cầu gốc có ở đơn từ yêu cầu, không bắt buộc ở đơn độc lập.
- **Dòng đơn**: Nguyên liệu, đơn vị, số lượng, đúng một cơ sở nguồn cung đã chọn và một QR ổn định; đơn từ yêu cầu khớp dòng nguồn, đơn độc lập chọn nguyên liệu của nhà cung cấp hiện hành.
- **Cơ sở nguồn cung**: Cơ sở thuộc riêng một nhà cung cấp, có mã/tên/trạng thái; được chọn lúc tạo dòng và giữ thông tin nguồn đã ghi nhận cho truy xuất lịch sử. Khác với trường nhận hàng.
- **Dãy mã đơn theo nhà cung cấp**: Cấp số tăng cho mã `FP-DE-…` trong từng nhà cung cấp, không dùng chung với dãy mã cơ sở hoặc mã hồ sơ đăng ký.
- **Nhãn QR của dòng đơn**: Một liên kết truy xuất công khai có giới hạn cho đúng dòng/đơn/nguồn; được lấy lại để in, không tương đương định danh riêng cho từng bao bì hoặc quyền kiểm nhận.
- **Quyết định kiểm nhận**: Kết quả đạt/không đạt, vai trò/người/thời điểm và lý do theo chính sách hiện hành; quyết định thuộc riêng từng đơn, không sao chép sang đơn giao lại.
- **Quan hệ nhà cung cấp–trường**: Xác định các trường đủ điều kiện được chọn khi tạo độc lập; phải được kiểm tra lại khi ghi nhận.
- **Người lập đơn**: Admin hoặc staff nhà cung cấp có quyền phù hợp, được ghi nhận từ danh tính hiện hành.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Cả admin và staff đủ quyền đều tạo và xem lại được đơn theo cả hai cách; đơn độc lập tạo thành công khi không có yêu cầu nguồn hoặc phiếu bị từ chối.
- **SC-002**: 100% đơn từ yêu cầu có đầy đủ và đúng nguyên liệu/đơn vị/toàn bộ số lượng nguồn; 100% đơn độc lập có trường nhận thuộc tập đã liên kết được phép và nguyên liệu thuộc nhà cung cấp; mỗi dòng ở cả hai cách có đúng một nguồn hợp lệ và một QR riêng.
- **SC-003**: 100% tình huống thiếu trường nhận, chọn trường chưa liên kết, sai quyền/phạm vi, nguyên liệu/số lượng/nguồn không hợp lệ hoặc thiếu biển số xe/thời gian dự kiến bị chặn mà không lưu đơn dở dang.
- **SC-004**: Sau gửi lại hoặc thao tác đồng thời, mỗi yêu cầu có tối đa một đơn từ yêu cầu; không sinh bản sao từ cùng thao tác ở cả hai cách tạo, nhưng các ý định tạo đơn độc lập riêng biệt vẫn được phép.
- **SC-005**: Tạo đơn độc lập không sửa dữ liệu yêu cầu/phiếu giao cũ, quyết định kiểm nhận hay lịch sử kho trong toàn bộ kịch bản chấp nhận.
- **SC-006**: Với hai nhà cung cấp chưa có mã định dạng mới, mã đầu tiên của mỗi bên là `FP-DE-00001`; trong tình huống ít nhất 20 lần tạo riêng biệt đồng thời ở mỗi bên không có mã trùng trong cùng nhà cung cấp và không có QR trỏ nhầm dòng.
- **SC-007**: Với đơn có N dòng, nhà cung cấp lấy được đúng N QR phân biệt và 100% lần quét bằng thiết bị chưa đăng nhập cho đúng nguyên liệu/nguồn/đơn trong phạm vi công khai; in lại không đổi QR và không lộ trường thông tin ngoài danh sách được phép.
- **SC-008**: 100% đơn mới thành công bắt đầu đang giao hàng; 100% tình huống thiếu ít nhất một trong bốn xác nhận đạt hoặc có quyết định không đạt không được hoàn thành/nhập kho.
- **SC-009**: 100% đơn đủ bốn xác nhận đạt và đáp ứng điều kiện nhận hàng được hoàn thành, với đúng một lần ghi nhận kho cho mỗi lô ngay cả khi quyết định cuối được gửi đồng thời hoặc gửi lại.
- **SC-010**: 100% quyết định không đạt hợp lệ thể hiện yêu cầu giao lại và lý do; nhà cung cấp lập được đơn thủ công mới đủ nguồn/QR/thông tin giao mà không dùng lại chữ ký cũ. Lần từ chối thứ ba của cùng yêu cầu vẫn cho kết quả hủy theo chính sách đã xác nhận.

## Assumptions

- Kế thừa hai vai trò admin/staff của nhà cung cấp; mọi thao tác phụ thuộc quyền hiệu lực hiện hành.
- “Đơn độc lập” là không bắt buộc yêu cầu nguyên liệu/phiếu giao trước; vẫn bắt buộc trường nhận đã liên kết. Không nhầm trường nhận với cơ sở nguồn cung nguyên liệu.
- Trường được chọn tuân thủ chính sách quan hệ hiện hành; mặc định chỉ quan hệ đang ACTIVE đủ điều kiện tạo đơn độc lập mới. Không áp điều kiện này hồi tố để tự thay đổi đơn từ yêu cầu đã tiếp nhận.
- Đơn độc lập không tự động được coi là lần thay thế trong chuỗi giao lại của yêu cầu cũ. Luồng sửa đổi thay trạng thái bắt đầu và bắt buộc nguồn/QR/thông tin giao; giữ bốn bên kiểm nhận, điều kiện nhận hàng và bộ đếm từ chối hiện có. Gắn đơn thủ công vào chuỗi cũ cần đặc tả riêng nếu được yêu cầu.
- Cách lưu đơn không có yêu cầu nguồn và cách đưa loại đơn này vào luồng giao/kiểm nhận là phần thiết kế phải xử lý rõ ở bước plan, dựa trên đối tượng bắt buộc là trường nhận và dòng nguyên liệu; không được tạo yêu cầu giả hoặc thay quy tắc hiện hành ngoài phạm vi.
- Phạm vi sửa đổi gồm hai cách tạo, lựa chọn nguồn, mã theo nhà cung cấp, nhãn QR/truy xuất công khai có giới hạn, danh sách/chi tiết và trạng thái gắn với kiểm nhận. Không bổ sung sửa/xóa đơn đã tạo, theo dõi xe trực tiếp, báo giá, thuế, thanh toán, hóa đơn hoặc định danh riêng từng bao bì. Thiết kế giao diện, bố cục nhãn chuyên biệt, định dạng tệp in và tích hợp máy in chưa được yêu cầu.
- Một nguyên liệu xuất hiện tối đa một dòng trong một đơn và có một nguồn/QR cho dòng đó; muốn giao cùng nguyên liệu từ nhiều cơ sở trong một đơn cần yêu cầu bổ sung, không tự chia dòng/lô trong phạm vi này.
- Nguồn đã ghi nhận gồm ít nhất định danh cơ sở và tên/mã tại lúc tạo; không công khai thông tin liên hệ cá nhân. Nhiều lô của cùng dòng nếu được lập theo luồng nhận hàng đều phải giữ cùng nguồn. Dừng cơ sở chỉ ngăn chọn cho đơn mới, không phá nguồn của đơn đang giao.
- “Hoàn thành” là kết quả đã nhận hàng thành công sau bốn xác nhận đạt, không phải chỉ bắt đầu vận chuyển hoặc riêng một lần quét QR. Hàng phải đến trường trước kiểm nhận; bước plan cần mô tả rõ cách ghi nhận đến nơi và các dữ liệu lô cần thiết, không cho kiểm nhận khi chưa đến.
- Mã đơn theo nhà cung cấp có thể trùng giữa các bên, còn định danh riêng của đơn và QR không được nhầm lẫn. Không thay đổi cách cấp mã cơ sở `FP-SF-…` đã xác nhận.
- Chỉ cập nhật đặc tả và trạng thái tài liệu thiết kế ở bước này; chưa triển khai tính năng, đổi dữ liệu/schema, chạy migration hoặc tạo dữ liệu mẫu.
