# Feature Specification: Tạo đơn giao hàng theo từng bước, có nguồn cung và QR truy xuất

**Feature Branch**: `feat/supplier-order-creation-stages`

**Created**: 2026-11-14

**Updated**: 2026-11-15

**Status**: Ready for implementation — spec/plan/tasks đã đồng bộ theo tách dòng khác nguồn, đơn thủ công không Đã xác nhận và tìm trường liên kết;57 task còn pending, chưa triển khai

**Input**: User description: "Tính năng tạo đơn hàng: sau khi tiếp nhận đơn hàng thì trạng thái là đã xác nhận, sau đó chuyển tới phần thêm nguyên liệu; thêm nguyên liệu xong thì trạng thái sang đang chuẩn bị hàng; sau đó nhập thời gian dự kiến và biển số xe, nhập xong thì trạng thái đang giao hàng." Yêu cầu hiện hành bổ sung: cùng thực phẩm được nhiều dòng khác cơ sở nguồn cung ở cả hai cách tạo, đơn từ yêu cầu giữ đúng tổng lượng nguồn; đơn thủ công do nhà cung cấp chủ động tạo nên không có bước/trạng thái Đã xác nhận; cần tìm kiếm trường đã liên kết để chọn bên nhận.

**Amendment scope**: Đơn từ yêu cầu đi theo **tiếp nhận → Đã xác nhận → hoàn tất nguyên liệu → Đang chuẩn bị hàng → lưu thời gian dự kiến và biển số xe → Đang giao hàng**. Đơn thủ công đi theo **tìm/chọn trường liên kết → thêm nguyên liệu → lưu thành Đang chuẩn bị hàng → lưu thời gian dự kiến và biển số xe → Đang giao hàng**, không có Đã xác nhận và không cần trường xác nhận trước khi lập đơn. Cả hai cho nhiều dòng cùng thực phẩm nhưng phải khác cơ sở nguồn cung; một dòng yêu cầu gốc có thể phân bổ nhiều nguồn trong cùng đơn với tổng lượng giữ nguyên. Giữ mã/QR, quyền, kiểm nhận sau giao và lịch sử. Plan/model/contracts/research/quickstart đã cập nhật theo các quy tắc vừa làm rõ;57 task T100–T156 đã cập nhật theo thiết kế hiện hành và đều pending; lịch sử T001–T099 giữ trong hai file task history. Các bước clarify/plan/tasks chỉ cập nhật đặc tả, thiết kế và danh sách công việc, không chứng minh tính năng đã được triển khai.

## Clarifications

### Session 2026-11-15

- Q: Khi chọn “thịt heo” lần thứ hai trong cùng một đơn hàng, bạn muốn hệ thống xử lý thế nào? → A: Cho thêm một dòng thịt heo với số lượng và nguồn cung riêng; nguồn cung phải khác mọi nguồn đã chọn cho thịt heo trong cùng đơn.
- Q: Nếu nhà trường yêu cầu 10 kg thịt heo, có cho tách thành 6 kg từ cơ sở A và 4 kg từ cơ sở B trong cùng đơn không? → A: A — áp dụng cho cả hai cách tạo; đơn từ yêu cầu được tách nhiều dòng khác nguồn nhưng phải giữ đúng tổng lượng của từng dòng yêu cầu gốc.
- Yêu cầu bổ sung được người dùng xác nhận: đơn thủ công do nhà cung cấp chủ động tạo, không có trạng thái Đã xác nhận hoặc bước xác nhận với trường trước khi lập đơn; giữ bước Đang chuẩn bị hàng sau khi lưu nguyên liệu và Đang giao hàng sau khi lưu thông tin vận chuyển.
- Yêu cầu bổ sung được người dùng xác nhận: cung cấp tìm kiếm trường đã liên kết với nhà cung cấp để chọn trường nhận đơn.
- Q: Nhà cung cấp chỉ tạo đơn từ yêu cầu đã tiếp nhận hay có thể tạo độc lập? → A: Hỗ trợ cả hai cách: tạo từ yêu cầu đã tiếp nhận và tạo độc lập không bắt buộc có yêu cầu nguồn.
- Q: Một yêu cầu được tạo một đơn toàn bộ hay chia nhiều đơn từng phần? → A: Q2 = A, một yêu cầu tạo một đơn chứa toàn bộ nguyên liệu và đúng toàn bộ số lượng yêu cầu; không chia đơn từ yêu cầu thành từng phần.
- Q: Nhu cầu đơn độc lập phát sinh từ đâu? → A: Phát sinh khi đơn giao trước bị yêu cầu giao lại; đây là mục đích sử dụng, không tự biến lịch sử từ chối thành điều kiện bắt buộc để tạo đơn độc lập.
- Q: Có chuyển cơ chế đơn độc lập thành chỉ tạo phiếu thay thế từ đơn bị từ chối không? → A: Giữ nguyên cơ chế tạo đơn độc lập; không bắt buộc liên kết yêu cầu nguyên liệu hoặc phiếu giao trước. Các giới hạn một phiếu thay thế cho một lần từ chối không áp vào cơ chế này.
- Q: Đơn độc lập có bắt buộc bên nhận không và chọn từ đâu? → A: Có. Bắt buộc chọn một trường mà nhà cung cấp đã liên kết. Từ “nguồn cung” trong câu trả lời này chỉ trường được chọn làm bên nhận, không phải cơ sở nguồn cung nguyên liệu.

### Amendment 2026-11-15 — Nguồn cung, QR và giao hàng

- Quyết định lịch sử: mỗi dòng nguyên liệu có đúng một cơ sở nguồn cung và một QR riêng; thông tin vận chuyển bắt buộc khi tạo và tạo xong đang giao hàng. Thời điểm nhập thông tin vận chuyển và chuyển trạng thái trong quyết định này được thay bởi bản sửa đổi theo từng bước bên dưới.
- Q1: Mã `FP-DE-00001` tăng chung hay theo nhà cung cấp? → A: B — mỗi nhà cung cấp có dãy riêng, đều bắt đầu `FP-DE-00001`. Mã hiển thị có thể trùng giữa các nhà cung cấp.
- Q2: Ai được xem khi quét QR? → A: B — ai có QR đều xem được thông tin truy xuất công khai có giới hạn, không bắt buộc đăng nhập.
- Q3: Có giữ quy tắc lần từ chối thứ ba hủy yêu cầu và các đợt chưa nhận? → A: A — giữ giới hạn hiện hành; đơn thủ công vẫn độc lập như đã chốt, không tự liên kết hoặc đặt lại chuỗi giao lại cũ.

### Amendment 2026-11-15 — Xác nhận, chuẩn bị và bắt đầu giao

- Tiếp nhận thành công yêu cầu của trường phải thể hiện **Đã xác nhận**, rồi cho thực hiện bước thêm nguyên liệu; chưa chuyển sang chuẩn bị hoặc giao hàng.
- Hoàn tất và lưu đầy đủ nguyên liệu cùng nguồn cung hợp lệ mới chuyển sang **Đang chuẩn bị hàng**. Sau đó thực hiện bước nhập thời gian giao dự kiến và biển số xe.
- Lưu thành công cả thời gian giao dự kiến và biển số xe hợp lệ mới chuyển sang **Đang giao hàng**; không chuyển chỉ vì mở phần nhập liệu hoặc gõ xong một trường.
- Q: Luồng mới có áp dụng cho đơn tạo thủ công không? → A: Cả hai cách tạo đều có bước lưu nguyên liệu sang Đang chuẩn bị hàng rồi lưu thông tin vận chuyển sang Đang giao hàng. Theo yêu cầu bổ sung hiện hành, chỉ đơn từ yêu cầu có Đã xác nhận sau tiếp nhận; đơn thủ công chọn trường/thêm nguyên liệu trực tiếp, không có trạng thái này.
- **Đã xác nhận** là xác nhận xử lý đơn của nhà cung cấp, không phải xác nhận kiểm nhận đạt của trường.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Tạo đơn từ yêu cầu đã tiếp nhận (Priority: P1)

Là admin hoặc staff nhà cung cấp có quyền phù hợp, tôi muốn tiếp nhận yêu cầu với trạng thái Đã xác nhận, rồi hoàn tất nguyên liệu để đơn chuyển sang Đang chuẩn bị hàng trước khi nhập thông tin vận chuyển.

**Why this priority**: Nối bước tiếp nhận với thực hiện đơn, tránh nhập lại hoặc thay sai đối tác, nguyên liệu và số lượng.

**Independent Test**: Dùng cả hai vai trò tiếp nhận và xử lý hai yêu cầu khác nhau; kiểm tra Đã xác nhận sau tiếp nhận, lưu đủ nguyên liệu/nguồn khi chưa có biển số xe hoặc thời gian giao, rồi đối chiếu Đang chuẩn bị hàng và toàn bộ lượng nguồn.

**Acceptance Scenarios**:

1. **Given** yêu cầu đang chờ tiếp nhận thuộc nhà cung cấp mình và người dùng đủ quyền tiếp nhận, **When** tiếp nhận thành công, **Then** đơn hiển thị Đã xác nhận, giữ người/thời điểm tiếp nhận; bước tiếp theo là thêm nguyên liệu bởi người có quyền tạo/quản lý đơn, chưa bắt buộc biển số xe hoặc thời gian giao dự kiến.
2. **Given** yêu cầu đã tiếp nhận, chưa có đơn giao được lập và mỗi dòng đã chọn nguồn cung hợp lệ, **When** xác nhận hoàn tất thêm nguyên liệu, **Then** lưu một đơn có mã `FP-DE-…` riêng trong nhà cung cấp, đủ nguyên liệu và đúng tổng lượng/đơn vị của từng dòng yêu cầu gốc, cho phép phân bổ thành nhiều dòng khác nguồn với một QR mỗi dòng và liên kết yêu cầu gốc; trạng thái là Đang chuẩn bị hàng, yêu cầu nguồn chuyển sang đang thực hiện cùng thao tác và bước kế tiếp là nhập thông tin vận chuyển.
3. **Given** người dùng bỏ nguyên liệu yêu cầu, đổi nguyên liệu/đơn vị hoặc phân bổ tổng lượng khác yêu cầu gốc, **When** xác nhận, **Then** bị từ chối và không tạo đơn sai, thiếu hoặc vượt lượng; việc tăng số dòng do tách nguồn hợp lệ không bị coi là bỏ/thêm nguyên liệu.
4. **Given** yêu cầu đã có đơn ở Đang chuẩn bị hàng hoặc giai đoạn sau, **When** mở lại hoặc gửi lại bước thêm nguyên liệu, **Then** nhận diện đơn hiện có để tiếp tục đúng bước, không tạo thêm đơn hoặc đưa trạng thái lùi lại.
5. **Given** yêu cầu chưa tiếp nhận, đã hoàn thành hoặc đã hủy, **When** tạo từ yêu cầu, **Then** bị từ chối và không thay đổi dữ liệu.
6. **Given** yêu cầu ngoài nhà cung cấp hoặc không tồn tại, **When** tạo đơn, **Then** trả cùng loại thông báo không tìm thấy.
7. **Given** nội dung nguyên liệu được kế thừa từ yêu cầu, **When** chọn nguồn cung và phân bổ số lượng cho từng dòng giao, **Then** có thể dùng nhiều dòng cùng nguyên liệu từ các cơ sở khác nhau, giữ đúng nguyên liệu/đơn vị và tổng lượng theo từng dòng yêu cầu gốc; không bỏ nguyên liệu hoặc tự tăng/giảm tổng lượng nguồn.
8. **Given** thiếu dòng, lượng hoặc nguồn cung bắt buộc của bất kỳ dòng nào, **When** xác nhận hoàn tất thêm nguyên liệu, **Then** báo lỗi tương ứng và đơn vẫn ở Đã xác nhận; thiếu biển số xe hoặc thời gian giao dự kiến không ngăn hoàn tất bước nguyên liệu.
9. **Given** yêu cầu đã được tiếp nhận và đơn đã tiến tới chuẩn bị hoặc giao hàng, **When** gửi lại thao tác tiếp nhận, **Then** giữ người/thời điểm tiếp nhận đầu tiên và trạng thái hiện tại, không đưa đơn về Đã xác nhận.
10. **Given** trường yêu cầu 10 kg thịt heo, **When** phân bổ 6 kg từ A và 4 kg từ B rồi lưu, **Then** tạo một đơn có hai dòng thịt heo và hai QR riêng, cả hai cùng đối chiếu về dòng yêu cầu 10 kg; không tạo thêm đơn hoặc sửa yêu cầu gốc.
11. **Given** cùng yêu cầu 10 kg thịt heo, **When** tổng các dòng là 9 kg hoặc 11 kg, hoặc hai dòng đều từ A, **Then** báo lỗi phân bổ hoặc trùng nguồn và không chuyển sang Đang chuẩn bị hàng.

---

### User Story 2 - Tạo đơn độc lập cho trường đã liên kết (Priority: P1)

Là admin hoặc staff nhà cung cấp có quyền phù hợp, tôi muốn tìm và chọn trường đã liên kết rồi chủ động thêm nguyên liệu để lập đơn độc lập ở Đang chuẩn bị hàng, kể cả giao lại khi không có yêu cầu mới. Tôi không phải thực hiện tiếp nhận hoặc xác nhận đơn với trường trước khi tạo, và đơn thủ công không hiển thị Đã xác nhận.

**Why this priority**: Cho phép nhà cung cấp chủ động lập đơn theo nhu cầu thực tế mà vẫn xác định đúng trường nhận và quyền sở hữu nguyên liệu.

**Independent Test**: Với cả admin/staff đủ quyền, tìm trường linked theo một phần tên hoặc mã, chọn trường rồi lưu nguyên liệu/nguồn khi chưa nhập vận chuyển. Trước khi lưu không có trạng thái Đã xác nhận hoặc đơn rỗng; lưu xong là Đang chuẩn bị hàng. Thử trường ngoài liên kết, truy cập supplier khác, kết quả rỗng, phân trang và nguồn/nguyên liệu không hợp lệ.

**Acceptance Scenarios**:

1. **Given** nhà cung cấp có trường đã liên kết đủ điều kiện cung ứng hiện hành, **When** tìm và chọn trường nhận hợp lệ để tạo đơn độc lập, **Then** chuyển tới thêm nguyên liệu mà không thực hiện bước tiếp nhận/xác nhận hoặc gán trạng thái Đã xác nhận; không tạo đơn rỗng và chưa bắt buộc thông tin vận chuyển.
2. **Given** đã chọn trường hợp lệ, nguyên liệu thuộc nhà cung cấp, số lượng/đơn vị hợp lệ và nguồn cung cho từng dòng, **When** xác nhận hoàn tất thêm nguyên liệu, **Then** lưu đơn độc lập có mã `FP-DE-…`, trạng thái Đang chuẩn bị hàng, QR cho từng dòng và người/thời điểm tạo; bước kế tiếp là nhập thông tin vận chuyển.
3. **Given** không chọn trường hoặc chọn trường chưa liên kết/không còn được phép cung ứng, **When** xác nhận, **Then** bị từ chối và không tạo đơn.
4. **Given** nguyên liệu ngoài phạm vi, hai dòng cùng nguyên liệu và cùng cơ sở nguồn cung, danh sách rỗng, thiếu nguồn hoặc số lượng không dương, **When** lưu nguyên liệu, **Then** báo rõ dòng sai, giữ nội dung đang nhập để sửa và không tạo đơn không hợp lệ hoặc tự gán Đã xác nhận; cùng nguyên liệu khác nguồn vẫn hợp lệ.
5. **Given** không có yêu cầu nguyên liệu hoặc lịch sử giao bị từ chối, **When** tạo độc lập với nội dung hợp lệ, **Then** vẫn tạo thành công.
6. **Given** người dùng có ý định lập hai đơn độc lập riêng biệt có cùng trường/nguyên liệu, **When** xác nhận từng thao tác, **Then** không bị giới hạn một đơn do quy tắc Q2; chỉ thao tác gửi lại cùng lần tạo mới phải chống trùng.
7. **Given** đơn đã có thịt heo 6 kg từ cơ sở A, **When** chọn thịt heo thêm lần nữa và nhập 4 kg từ cơ sở B, **Then** có hai dòng độc lập với số lượng/nguồn riêng, được giữ nguyên khi lưu và có hai QR khác nhau; không gộp thành một dòng 10 kg.
8. **Given** đã có thịt heo từ A và B, **When** thêm dòng thịt heo thứ ba, **Then** phải chọn nguồn khác cả A và B; cùng nguồn A vẫn được chọn cho một nguyên liệu khác, chẳng hạn cà rốt.
9. **Given** có trường linked đủ điều kiện tên Hoa Mai, **When** tìm bằng một phần tên “hoa” hoặc một phần mã trường không phân biệt hoa/thường, **Then** nhận đúng các trường phù hợp thuộc nhà cung cấp hiện tại, kèm định danh/mã/tên và phân trang; không lộ trường ngoài phạm vi hoặc dữ liệu liên hệ/tài khoản.
10. **Given** chưa nhập từ khóa hoặc chỉ có khoảng trắng, **When** tìm trường, **Then** nhận danh sách lựa chọn mặc định có phân trang; từ khóa không khớp trả danh sách trống.
11. **Given** trường của supplier khác, chưa liên kết, quan hệ đã dừng hoặc không còn đủ điều kiện tạo đơn, **When** tìm hoặc cố chọn trường đó để lưu đơn thủ công, **Then** không được phép sử dụng; kết quả tìm trước đó không bỏ qua kiểm tra lại điều kiện lúc lưu.

---

### User Story 3 - Xem lại kết quả và tránh tạo trùng (Priority: P2)

Là admin hoặc staff có quyền xem, tôi muốn xem đơn đã tạo, phân biệt đơn từ yêu cầu với đơn độc lập và tránh bản sao khi thao tác được gửi lại.

**Why this priority**: Xác định được kết quả tạo và nguồn đơn giúp xử lý đúng việc khi kết nối gián đoạn hoặc nhiều nhân viên cùng thao tác.

**Independent Test**: Tạo đơn theo cả hai cách, xem danh sách/chi tiết bằng hai vai trò, thử gửi lại và thử hai người cùng tạo từ một yêu cầu.

**Acceptance Scenarios**:

1. **Given** có đơn theo cả hai cách ở các bước khác nhau, **When** xem danh sách hoặc chi tiết, **Then** thấy cách tạo, trường nhận, trạng thái hiện tại và bước cần thực hiện; Đã xác nhận chỉ dành cho yêu cầu đã tiếp nhận để tiếp tục thêm nguyên liệu, Đang chuẩn bị hàng cho nhập thông tin vận chuyển, Đang giao hàng cho theo dõi giao; đơn thủ công không được gán Đã xác nhận. Mã, người/thời điểm tạo, nguyên liệu/nguồn/QR hiển thị khi đã được ghi nhận; thông tin vận chuyển còn trống trước khi giao không được tự suy đoán.
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

1. **Given** nhà cung cấp có các cơ sở đang hoạt động, **When** chọn nguồn cho từng dòng được phép của đơn, **Then** mỗi dòng phải chọn đúng một cơ sở của nhà cung cấp đó; cùng nguyên liệu ở nhiều dòng phải dùng các cơ sở khác nhau, còn các nguyên liệu khác nhau được dùng chung một cơ sở.
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

1. **Given** đơn đã hoàn tất nguyên liệu nhưng chưa lưu đủ thông tin vận chuyển, **When** xem hoặc thử xác nhận hàng đến/kiểm nhận, **Then** đơn vẫn Đang chuẩn bị hàng và chưa đủ điều kiện đến nơi/kiểm nhận; sau khi bắt đầu giao mới tiếp tục luồng đến nơi hiện hành.
2. **Given** hàng đã đến trường và đủ điều kiện kiểm nhận, **When** chưa đủ cả bốn vai trò xác nhận đạt, **Then** đơn chưa hoàn thành; quét QR không tự ghi quyết định kiểm nhận.
3. **Given** chưa có quyết định không đạt và ba vai trò đã xác nhận đạt, **When** vai trò còn lại xác nhận đạt và việc nhận hàng hợp lệ được ghi nhận, **Then** đơn hoàn thành, các lô/kho được ghi nhận đúng một lần; áp dụng cho cả hai cách tạo đơn.
4. **Given** đơn đang được kiểm nhận, **When** một vai trò đủ quyền ghi không đạt kèm lý do, **Then** đơn hiển thị yêu cầu giao hàng lại, không nhập kho theo đơn đó; những xác nhận đạt đến sau không đảo ngược quyết định không đạt.
5. **Given** đơn yêu cầu giao lại, **When** nhà cung cấp tạo đơn thủ công, **Then** đơn mới chọn trường và thêm nguyên liệu trực tiếp, không có Đã xác nhận; Đang chuẩn bị hàng sau lưu nguyên liệu/nguồn và Đang giao hàng sau lưu thông tin vận chuyển; có mã/QR mới và cần kiểm nhận mới từ đầu.
6. **Given** đơn cũ có lịch sử kiểm nhận, **When** tạo đơn thủ công mới, **Then** đơn cũ và quyết định cũ được giữ nguyên; không chuyển chữ ký, khôi phục yêu cầu đã hủy hoặc đặt lại số lần từ chối của yêu cầu cũ.
7. **Given** cùng yêu cầu đã có hai đợt bị từ chối, **When** đợt thứ ba bị từ chối, **Then** vẫn hủy yêu cầu và các đợt chưa nhận theo chính sách hiện hành; không thay đổi đợt đã nhận hoặc kho đã ghi.
8. **Given** nhiều người đồng thời gửi quyết định cuối hoặc gửi lại quyết định, **When** xử lý kết quả, **Then** mỗi vai trò có tối đa một quyết định bất biến cho một đơn và việc hoàn thành/nhập kho chỉ xảy ra một lần.

---

### User Story 6 - Lưu thông tin vận chuyển để bắt đầu giao (Priority: P1)

Là admin hoặc staff nhà cung cấp có quyền quản lý đơn, tôi muốn chỉ nhập thời gian giao dự kiến và biển số xe sau khi hoàn tất nguyên liệu; lưu thành công cả hai thông tin sẽ đưa đơn sang Đang giao hàng.

**Why this priority**: Trạng thái phải phản ánh đúng lúc bắt đầu giao; thiếu thông tin vận chuyển không được làm mất bước chuẩn bị đã hoàn tất.

**Independent Test**: Chuẩn bị mỗi cách tạo một đơn ở Đang chuẩn bị hàng, thử chỉ nhập một trường, nhập sai thời gian hoặc biển số trống, rồi lưu đủ hai trường. Mở lại đơn và gửi lại thao tác để kiểm tra trạng thái, mã và QR không đổi ngoài chuyển bước hợp lệ.

**Acceptance Scenarios**:

1. **Given** đơn Đang chuẩn bị hàng đã đủ nguyên liệu/nguồn/QR, **When** lưu thời gian giao dự kiến hợp lệ có múi giờ và biển số xe không rỗng, **Then** ghi nhận cả hai và chuyển sang Đang giao hàng trong cùng thao tác; không cần thêm bước đổi trạng thái riêng.
2. **Given** thiếu thời gian, thiếu biển số, biển số chỉ có khoảng trắng hoặc thời gian không hợp lệ, **When** lưu thông tin vận chuyển, **Then** báo lỗi tiếng Việt theo từng trường và giữ Đang chuẩn bị hàng cùng nguyên liệu/nguồn/QR đã lưu.
3. **Given** yêu cầu mới Đã xác nhận hoặc đơn thủ công chưa lưu đủ nguyên liệu hợp lệ, **When** cố bắt đầu giao hoặc chọn thẳng Đang giao hàng, **Then** bị chặn, không bỏ qua bước nguyên liệu, không tạo trạng thái giả hoặc đổi trạng thái đã lưu.
4. **Given** mở bước vận chuyển hoặc mới nhập một phần nhưng chưa lưu thành công, **When** xem lại đơn, **Then** trạng thái vẫn Đang chuẩn bị hàng.
5. **Given** lần bắt đầu giao đã thành công nhưng kết nối bị gián đoạn, **When** gửi lại đúng thao tác, **Then** nhận lại kết quả hiện tại, không đổi mã/QR, không tạo đơn khác và không đưa trạng thái lùi lại.
6. **Given** quyền bị thu hồi, đơn bị hủy hoặc người khác đã chuyển bước trước lúc lưu, **When** lưu thông tin vận chuyển, **Then** xác minh lại điều kiện hiện tại, từ chối thao tác không còn hợp lệ và không ghi một phần thông tin hoặc ghi đè tiến độ mới.

### Edge Cases

- Cùng nguyên liệu và khác cơ sở nguồn cung là các dòng hợp lệ riêng biệt; cùng nguyên liệu và cùng cơ sở bị chặn dù số lượng khác nhau.
- Quy tắc khác nguồn áp dụng với tất cả dòng của cùng nguyên liệu, không chỉ dòng liền trước; dòng thịt heo thứ ba không được dùng lại nguồn của dòng thứ nhất.
- Khi không còn cơ sở hợp lệ chưa dùng cho nguyên liệu đang chọn, không thể hoàn tất dòng mới nếu chưa chọn được nguồn khác; các dòng hợp lệ đã nhập được giữ nguyên.
- Sửa nguồn của dòng trước khi hoàn tất nguyên liệu cũng phải kiểm quy tắc trùng cặp; không tự gộp các dòng hoặc cộng số lượng để bỏ qua lỗi.
- Không có yêu cầu nguồn không ngăn tạo độc lập; thiếu trường nhận hoặc trường không thuộc tập đã liên kết hợp lệ phải ngăn tạo độc lập.
- Danh sách trường liên kết hoặc kết quả tìm rỗng: hiển thị không có trường phù hợp, cho đổi/xóa từ khóa và không cho lưu đơn khi chưa chọn được trường hợp lệ.
- Từ khóa được bỏ khoảng trắng đầu/cuối; phân trang/lọc luôn nằm trong trường linked đủ điều kiện của nhà cung cấp hiện tại, không dùng từ khóa hoặc supplier do người dùng nhập để mở rộng quyền truy cập.
- Trường liên kết hợp lệ khi mở form nhưng quan hệ đổi trước khi ghi nhận: xác minh lại và từ chối nếu không còn được phép tạo độc lập.
- Nhà cung cấp luôn lấy từ tài khoản hiện hành; không cho giả mạo tổ chức hoặc chọn nguyên liệu thuộc đơn vị khác.
- Đơn từ yêu cầu phải giữ nguyên trường, đủ nguyên liệu/đơn vị và đúng tổng lượng của từng dòng nguồn dù phân bổ qua nhiều cơ sở. Không được bù thiếu thịt heo bằng lượng của nguyên liệu khác hoặc bù giữa hai dòng yêu cầu gốc. Đơn độc lập không bị giới hạn lượng bởi một yêu cầu không liên quan.
- Sau tiếp nhận, yêu cầu ở Đã xác nhận cho đến khi nguyên liệu hoàn tất. Đơn thủ công chỉ đang nhập sau chọn trường, không có Đã xác nhận hoặc record rỗng; chỉ khi lưu nguyên liệu/nguồn hợp lệ mới có đơn ở Đang chuẩn bị hàng.
- Đóng rồi mở lại đơn từ yêu cầu sau tiếp nhận phải thấy Đã xác nhận; sau lưu nguyên liệu phải tiếp tục từ Đang chuẩn bị hàng, không yêu cầu lập đơn/QR mới.
- Mở lại đơn đã lưu ở Đang chuẩn bị hàng khi chưa có biển số/thời gian vẫn hợp lệ; không ép thông tin vận chuyển ở bước nguyên liệu.
- Gửi dữ liệu nguyên liệu và thông tin giao cùng lúc không được dùng để bỏ qua các bước; không có thao tác tùy ý chọn trạng thái.
- Quyền, membership hoặc trạng thái nguồn thay đổi trong lúc tạo: kiểm tra lại trước khi ghi; lỗi giữa chừng không để lại đơn thiếu dòng.
- Tạo độc lập để giao lại không tự sửa đơn cũ, xóa quyết định kiểm nhận, khôi phục yêu cầu bị hủy hoặc đặt lại bộ đếm của yêu cầu cũ.
- Tạo đơn chưa tự xác nhận đến nơi, được duyệt, trường đã nhận hoặc làm thay đổi tồn kho.
- Hai người tạo đồng thời phải không trùng mã trong cùng nhà cung cấp; hai nhà cung cấp được dùng cùng số thứ tự. Dãy vượt 99999 vẫn giữ đủ chữ số; không quay về đầu hoặc tái sử dụng mã đã cấp.
- Cùng một nguyên liệu ở hai đơn hoặc hai nhà cung cấp có cùng mã hiển thị vẫn có QR phân biệt được từng dòng; in nhiều nhãn cho cùng dòng không sinh định danh bao bì mới.
- Thiếu, rỗng hoặc chỉ có khoảng trắng ở biển số xe; thời gian thiếu, không hợp lệ hoặc không xác định được múi giờ phải chặn bước bắt đầu giao, không chặn tiếp nhận/chọn trường hoặc hoàn tất nguyên liệu.
- Nguồn cung dừng sau khi nguyên liệu đã được ghi nhận không tự xóa nguồn/QR hoặc làm đơn lùi bước; giữ chính sách nguồn đã ghi nhận hiện hành.
- Đơn đã đang giao, đến nơi, kiểm nhận, hoàn thành hoặc hủy không được đưa về Đã xác nhận/Đang chuẩn bị hàng bằng cách gửi lại bước trước. Đơn lịch sử giữ trạng thái hiện có, không tự chuyển sang quy trình mới.
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
- **FR-004**: Sau khi hoàn tất thêm nguyên liệu, mỗi đơn MUST có định danh riêng, mã nghiệp vụ do hệ thống sinh theo FR-015, cách tạo, trạng thái, trường nhận và người/thời điểm tạo. Mã nghiệp vụ không được lấy từ hoặc cắt ngắn định danh ngẫu nhiên. Chỉ đơn từ yêu cầu bắt buộc liên kết yêu cầu gốc; không tạo yêu cầu nhà trường giả cho đơn độc lập.
- **FR-005**: Khi hoàn tất bước thêm nguyên liệu, đơn từ yêu cầu MUST bao phủ mọi dòng yêu cầu gốc; mỗi dòng gốc được phân bổ thành một hoặc nhiều dòng giao cùng nguyên liệu/đơn vị, tổng lượng phân bổ phải bằng đúng lượng được yêu cầu. Mỗi dòng giao có lượng dương và nguồn riêng theo FR-014/FR-032; không thay yêu cầu gốc, bỏ nguyên liệu, tăng/giảm tổng lượng hoặc chia thành nhiều đơn. Đơn độc lập cho chọn nguyên liệu đang hoạt động của nhà cung cấp hiện hành, nhập lượng dương và đơn vị hợp lệ. Cả hai không được hoàn tất với danh sách rỗng hoặc trùng cặp nguyên liệu–cơ sở nguồn cung; cùng nguyên liệu khác nguồn là hợp lệ.
- **FR-006**: Đơn từ yêu cầu MUST qua Đã xác nhận sau tiếp nhận → Đang chuẩn bị hàng sau lưu nguyên liệu → Đang giao hàng sau lưu thông tin vận chuyển. Đơn thủ công MUST chọn trường/thêm nguyên liệu trực tiếp, không có bước/trạng thái Đã xác nhận; lần lưu đủ nguyên liệu đầu tiên tạo đơn ở Đang chuẩn bị hàng, rồi mới Đang giao hàng khi lưu thông tin vận chuyển. Cả hai chỉ bắt buộc biển số không rỗng và thời gian giao dự kiến hợp lệ, xác định được múi giờ tại bước bắt đầu giao; ghi chú tùy chọn. Không tự đến nơi, nhận đạt, hoàn thành hoặc nhập kho. Với đơn từ yêu cầu, lưu nguyên liệu chuyển nguồn ACCEPTED sang đang thực hiện trong cùng thao tác; nguồn đang thực hiện giữ trạng thái đó.
- **FR-007**: Một yêu cầu MUST chỉ tạo một đơn chứa toàn bộ nội dung theo Q2 = A; không chia đơn từng phần hoặc tạo thêm từ cùng yêu cầu. Quy tắc này chỉ áp dụng cho cách tạo từ yêu cầu, không giới hạn số đơn độc lập có ý định tạo riêng biệt.
- **FR-008**: Người có quyền xem trong nhà cung cấp MUST xem được danh sách phân trang và chi tiết cả hai cách tạo, nhận diện trường nhận và nguồn nếu có. Không trả dữ liệu ngoài phạm vi hoặc hồ sơ tài khoản nhạy cảm.
- **FR-009**: Trong bước hoàn tất nguyên liệu, ghi đơn/dòng/nguồn/QR/lô, liên kết yêu cầu nếu có và trạng thái Đang chuẩn bị hàng MUST cùng thành công hoặc cùng thất bại. Lỗi không để lại dữ liệu thiếu dòng/nguồn/QR; yêu cầu đã tiếp nhận giữ Đã xác nhận, còn đơn thủ công giữ phần đang nhập và không phát sinh bản ghi hoặc trạng thái Đã xác nhận. Trong bước bắt đầu giao, lưu thời gian dự kiến, biển số xe và Đang giao hàng cũng MUST cùng thành công hoặc cùng thất bại, lỗi giữ bước chuẩn bị đã lưu. Đơn độc lập không thay yêu cầu/phiếu giao cũ không liên quan.
- **FR-010**: Hệ thống MUST kiểm tra lại actor, role, quyền, membership và nội dung trước khi ghi nhận. Đơn từ yêu cầu kiểm tra lại trạng thái và giới hạn một đơn; đơn độc lập kiểm tra lại quan hệ với trường và quyền sở hữu nguyên liệu. Gửi lại cùng thao tác không tạo bản sao; tạo đồng thời từ cùng một yêu cầu không được sinh hai đơn.
- **FR-011**: Hệ thống MUST giữ phân quyền/cô lập tổ chức, điều kiện tiếp nhận và công việc đã nhận hiện hành. Tạo độc lập không tự sửa lịch sử kiểm nhận, nhập kho, yêu cầu đã hủy hoặc bộ đếm từ chối của đơn cũ. Tài khoản hệ thống hoặc nhà trường không có quyền ngầm tạo thay nhà cung cấp.
- **FR-012**: Hệ thống MUST báo lỗi tiếng Việt rõ ràng cho trường nhận, nguyên liệu, số lượng hoặc nguồn sai, thiếu quyền và xung đột trạng thái; không lộ nội dung ngoài phạm vi. Nguồn không tồn tại/ngoài phạm vi trả cùng loại thông báo không tìm thấy.
- **FR-013**: Nội dung đơn độc lập MUST do người tạo nhập từ danh mục nguyên liệu của nhà cung cấp và trường nhận đã liên kết. Không bắt buộc sao chép toàn bộ hoặc một phần phiếu bị từ chối. Nhu cầu giao lại là một trường hợp sử dụng cơ chế tạo độc lập; không tự thêm ràng buộc mỗi phiếu bị từ chối chỉ có một phiếu thay thế hoặc bắt buộc liên kết phiếu cũ.
- **FR-014**: Mỗi dòng nguyên liệu trong cả hai cách tạo MUST gắn đúng một cơ sở nguồn cung đang hoạt động thuộc nhà cung cấp hiện hành. Người tạo phải chọn nguồn cho từng dòng, không tự suy ra cơ sở từ nguyên liệu hoặc yêu cầu. Cho phép các nguyên liệu khác nhau dùng chung cơ sở; các dòng của cùng một nguyên liệu phải có cơ sở khác nhau. Mỗi dòng chỉ có một nguồn và một QR riêng; không gộp các nguồn vào một dòng. Staff có quyền tạo đơn được xem lựa chọn nguồn đủ điều kiện mà không cần quyền thêm/sửa/dừng cơ sở. Phải xác minh lại cơ sở lúc ghi nhận; lô phát sinh từ dòng phải giữ đúng nguồn đã chọn.
- **FR-015**: Mã nghiệp vụ MUST có tiền tố `FP-DE-` và số nguyên dương tăng theo dãy riêng của từng nhà cung cấp, thêm số 0 bên trái cho đủ tối thiểu năm chữ số: `FP-DE-00001`, `FP-DE-00002`. Nhà cung cấp khác cũng bắt đầu `FP-DE-00001`; không dùng riêng mã hiển thị để xác định một đơn toàn hệ thống. Cấp mã đồng thời không trùng trong cùng nhà cung cấp; mã đã cấp giữ nguyên và không tái sử dụng khi bị từ chối/hủy. Cho phép khoảng trống, không yêu cầu liên tục; vượt 99999 giữ đủ chữ số. Người dùng không nhập/sửa mã và gửi lại cùng thao tác không cấp mã mới.
- **FR-016**: Mỗi dòng nguyên liệu của một đơn MUST có đúng một QR riêng để truy xuất dòng đó, phân biệt được dòng ở đơn khác dù trùng nguyên liệu/mã hiển thị. Nhà cung cấp đủ quyền có thể lấy nhãn để in và lấy lại cùng QR; không cấp QR mới khi in lại hoặc gửi lại thao tác tạo.
- **FR-017**: Ai có QR hợp lệ MUST có thể xem thông tin truy xuất công khai của đúng dòng mà không đăng nhập. Nội dung công khai chỉ gồm tên nhà cung cấp, mã/trạng thái đơn, tên nguyên liệu, số lượng/đơn vị, tên/mã cơ sở nguồn cung được ghi nhận khi tạo. Không công khai toàn bộ đơn, trường nhận, biển số xe, lịch giao, thông tin liên hệ cá nhân, tài khoản, hợp đồng, giá, chữ ký hoặc lịch sử kiểm nhận chi tiết. Không cho dò dòng khác chỉ bằng sửa mã đơn/mã cơ sở; QR sai trả thông báo không tìm thấy an toàn. Quét chỉ đọc, không cập nhật trạng thái/quyết định.
- **FR-018**: Nhãn cho mỗi dòng MUST có QR cùng mã đơn, tên nguyên liệu và tên/mã cơ sở để nhà cung cấp phân biệt khi dán bao bì. Có thể in nhiều bản của cùng nhãn; chưa quản lý định danh riêng cho từng bao/gói. Nội dung nguồn đã ghi nhận MUST tiếp tục truy xuất được khi cơ sở đổi tên hoặc dừng; không đổi nguồn trên đơn đã tạo hoặc gán lại QR sang dòng/đơn khác.
- **FR-019**: Đơn chỉ được kiểm nhận khi hàng đã đến trường theo điều kiện nghiệp vụ hiện hành. Cả bốn vai trò của trường nhận — cán bộ dinh dưỡng, nhân viên bếp, bộ phận quản lý nguyên liệu và ban phụ huynh — MUST có quyết định đạt trên đúng đơn trước khi có thể hoàn thành. Người kiểm cần quyền hiệu lực trong đúng trường; không thay thế vai trò bằng việc một người xác nhận nhiều lần. Một quyết định bất biến cho mỗi vai trò trên mỗi đơn; gửi lại đúng quyết định không nhân bản, quyết định khác hoặc người khác ký thay vai trò đã ghi phải bị chặn.
- **FR-020**: Đơn MUST chỉ chuyển hoàn thành sau khi đủ bốn vai trò kiểm tra đạt, không có quyết định không đạt và đáp ứng điều kiện nhận hàng/lô hiện hành. Hoàn thành và ghi nhận nhập kho phải nhất quán, xảy ra đúng một lần dù có thao tác đồng thời; không hiển thị hoàn thành nếu bước nhận hàng thất bại. Không bỏ qua các điều kiện về trường, nguồn, lượng, đơn vị, ngày hoặc lịch sử lô để hoàn thành.
- **FR-021**: Khi một vai trò kiểm nhận hợp lệ ghi không đạt kèm lý do, đơn MUST hiển thị yêu cầu giao hàng lại và lý do; không tự hoàn thành hoặc nhập kho, không cho các xác nhận đạt đến sau đảo ngược kết quả. Nhà cung cấp có thể dùng tạo thủ công theo FR-013 để giao lại bằng một đơn mới, mã mới và QR mới; đơn mới cần đủ bốn quyết định mới.
- **FR-022**: Quy tắc từ chối lần thứ ba trong cùng yêu cầu MUST tiếp tục hủy yêu cầu và các đợt chưa nhận như hiện hành, giữ các đợt đã nhận và lịch sử kho. Đơn thủ công không bắt buộc nối với yêu cầu/đơn cũ, không tự tính vào, đặt lại hoặc phục hồi chuỗi giao lại của yêu cầu cũ; dữ liệu chuỗi cũ và đơn độc lập phải được phân biệt rõ.
- **FR-023**: Danh sách/chi tiết trong phạm vi quản lý MUST thể hiện nhất quán trạng thái hiện tại, nhà cung cấp và bước kế tiếp theo FR-025–FR-027; chỉ cho thực hiện hành động khi có quyền hiệu lực tương ứng. Mã nghiệp vụ, nguyên liệu/nguồn/QR hiển thị khi đã ghi nhận; thông tin vận chuyển được phép còn trống ở Đã xác nhận/Đang chuẩn bị hàng và bắt buộc đầy đủ từ lúc bắt đầu giao đối với đơn theo luồng mới. Trạng thái giai đoạn sau tiếp tục nhất quán với kiểm nhận. Chỉ QR đã công khai được truy cập không đăng nhập; quản lý/kiểm nhận vẫn tuân thủ quyền và tổ chức hiện hành.
- **FR-024**: Bổ sung các quy tắc mới MUST giữ nguyên định danh, mã hiện có, quyết định, lô và lịch sử kho của đơn cũ; không tự cấp nguồn không có căn cứ hoặc viết lại lịch sử thành đạt chuẩn đơn mới. Nhãn và trường bắt buộc mới áp dụng cho đơn tạo theo luồng sửa đổi; xử lý kỹ thuật cho dữ liệu cũ phải được thiết kế trước khi triển khai.
- **FR-025**: Chỉ việc tiếp nhận yêu cầu của trường thành công mới MUST thể hiện Đã xác nhận và bước thêm nguyên liệu tiếp theo, giữ người/thời điểm nhận đầu tiên cùng điều kiện/quyền tiếp nhận hiện hành. Đơn thủ công do nhà cung cấp chủ động tạo MUST không có trạng thái hoặc bước Đã xác nhận, không cần trường xác nhận trước khi tạo và không tạo yêu cầu giả; chọn trường hợp lệ rồi thêm nguyên liệu trực tiếp. Quyền xem/tiếp nhận không tự cấp quyền tạo/quản lý đơn. Đã xác nhận của yêu cầu không tương đương kiểm nhận đạt hoặc nhận hàng.
- **FR-026**: Từ yêu cầu Đã xác nhận, hoặc từ bước nhập nguyên liệu của đơn thủ công sau chọn trường, chỉ khi người dùng lưu đủ nguyên liệu/nguồn hợp lệ theo FR-005/FR-014/FR-032 thì hệ thống MUST tạo/chuyển đơn sang Đang chuẩn bị hàng và cho nhập thông tin vận chuyển. Mở form, nhập một phần hoặc lưu lỗi không hoàn tất bước; thiếu thời gian dự kiến/biển số xe không ngăn lưu nguyên liệu. Đơn thủ công không bị ép qua Đã xác nhận để thực hiện bước này.
- **FR-027**: Chỉ từ Đang chuẩn bị hàng, hệ thống MUST cho lưu đồng thời thời gian giao dự kiến và biển số xe để bắt đầu giao; sau khi lưu thành công tự chuyển sang Đang giao hàng, không yêu cầu thêm thao tác đổi trạng thái. Thời gian thiếu, không xác định được múi giờ hoặc không hợp lệ; biển số thiếu, rỗng sau loại khoảng trắng đầu/cuối hoặc vượt giới hạn 40 ký tự đều phải báo lỗi theo trường và giữ nguyên bước chuẩn bị. Không tự suy diễn thêm điều kiện thời gian phải ở tương lai.
- **FR-028**: Hệ thống MUST ngăn bỏ qua, đảo thứ tự hoặc tùy ý chọn trạng thái; áp đúng luồng riêng của từng cách tạo và không thêm Đã xác nhận vào đơn thủ công. Mở form, gõ xong biển số nhưng chưa lưu đủ hai trường hoặc gửi nguyên liệu kèm thông tin giao trong một lần không thay cho các bước riêng. Chưa Đang giao hàng không được xác nhận đến nơi hoặc bắt đầu kiểm nhận.
- **FR-029**: Mỗi bước MUST kiểm tra lại người thực hiện, quyền, phạm vi tổ chức, trạng thái và điều kiện nghiệp vụ hiện hành trước khi ghi nhận. Gửi lại đúng thao tác đã thành công hoặc nhiều người chuyển cùng bước không được tạo thêm đơn, mã, QR, ghi nhận kho hoặc đưa trạng thái lùi lại; thao tác từ dữ liệu cũ không được ghi đè tiến độ mới. Gửi lại cùng thao tác với nội dung khác không được ngầm sửa kết quả đã lưu.
- **FR-030**: Đơn từ yêu cầu MUST cho người đủ quyền mở lại để tiếp tục bước thêm nguyên liệu sau tiếp nhận; cả hai cách tạo MUST cho mở lại đơn đã Đang chuẩn bị hàng để nhập thông tin vận chuyển, giữ nguyên mã, nguyên liệu, nguồn và QR. Không yêu cầu thực hiện lại bước đã hoàn tất. Việc lưu bản nhập dở trước khi hoàn tất nguyên liệu không thuộc yêu cầu lần này.
- **FR-031**: Luồng mới MUST chỉ thay các bước trước khi giao hàng; giữ điều kiện đến nơi, bốn bên kiểm nhận, hoàn thành/nhập kho, giao lại và dữ liệu lịch sử đã được xác nhận. Không tự đưa đơn đang giao hoặc giai đoạn sau về các bước trước, không bổ sung sửa/xóa nội dung đơn đã hoàn tất nguyên liệu hay thay thông tin giao sau khi đã bắt đầu giao.
- **FR-032**: Khi người dùng chọn lại cùng một nguyên liệu trong đơn theo cả hai cách tạo, hệ thống MUST cho thêm dòng riêng có số lượng dương và đúng một cơ sở nguồn cung riêng; không tự gộp hoặc cộng số lượng vào dòng trước. Trong một đơn, mỗi cặp nguyên liệu–cơ sở nguồn cung chỉ xuất hiện tối đa một lần. Bất kỳ dòng nào trùng cặp với một dòng khác phải bị chặn và báo rõ vị trí lỗi trước khi hoàn tất nguyên liệu; các dòng khác giữ nguyên.
- **FR-033**: Với các dòng cùng nguyên liệu và khác nguồn được lưu thành công, hệ thống MUST giữ định danh, số lượng, nguồn và QR riêng cho từng dòng khi xem chi tiết, lấy nhãn, quét QR hoặc gửi lại thao tác. Không dùng tên nguyên liệu đơn thuần để gộp hoặc nhầm các dòng; việc chống tạo trùng đơn vẫn áp dụng như hiện hành.
- **FR-034**: Hệ thống MUST cung cấp khả năng tìm trường đã liên kết để ứng dụng chọn bên nhận đơn thủ công, theo một phần tên hoặc mã trường, không phân biệt chữ hoa/thường. Từ khóa được bỏ khoảng trắng đầu/cuối; thiếu hoặc rỗng sau chuẩn hóa trả danh sách lựa chọn mặc định, không khớp trả danh sách trống. Kết quả có định danh/mã/tên trường, phân trang và thứ tự ổn định khi dữ liệu không đổi, mặc định20 trường/trang và tối đa100.
- **FR-035**: Tìm trường MUST yêu cầu admin/staff nhà cung cấp đang hoạt động, membership hợp lệ và quyền tạo/quản lý đơn hiệu lực; nhà cung cấp tìm kiếm được xác định từ danh tính hiện hành, không tùy chọn bằng dữ liệu người dùng nhập. Chỉ trả trường đã liên kết và còn đủ điều kiện tạo đơn thủ công theo chính sách hiện có; không trả trường của đơn vị khác, trường chưa liên kết hoặc dữ liệu liên hệ/tài khoản không cần thiết. Kết quả tìm không thay thế kiểm tra lại quyền, quan hệ và điều kiện cung ứng lúc lưu đơn.

### Business State Transitions

| Bước hiện tại                                                   | Hành động hoàn tất       | Điều kiện                                                                                            | Trạng thái sau thành công                           | Bước tiếp theo                                             |
| --------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Yêu cầu đang chờ tiếp nhận                                      | Nhà cung cấp tiếp nhận   | Đúng phạm vi, đủ quyền và điều kiện tiếp nhận                                                        | Đã xác nhận                                         | Thêm nguyên liệu                                           |
| Bắt đầu đơn thủ công                                            | Tìm/chọn trường nhận     | Trường linked đủ điều kiện, người dùng có quyền tạo                                                  | Chưa phát sinh trạng thái đơn; không có Đã xác nhận | Thêm nguyên liệu                                           |
| Đã xác nhận của yêu cầu hoặc bước thêm nguyên liệu đơn thủ công | Lưu nguyên liệu          | Đủ nguyên liệu/nguồn/QR; tổng lượng từng dòng yêu cầu đúng nếu có nguồn yêu cầu; chưa cần vận chuyển | Đang chuẩn bị hàng                                  | Nhập thời gian dự kiến và biển số xe                       |
| Đang chuẩn bị hàng                                              | Lưu thông tin vận chuyển | Cả thời gian giao dự kiến và biển số xe đều hợp lệ                                                   | Đang giao hàng                                      | Theo dõi giao, đến nơi và kiểm nhận theo quy tắc hiện hành |

Thao tác thất bại giữ bước đã hoàn tất gần nhất. Các nhãn trên mô tả tiến độ nghiệp vụ; bước lập kế hoạch phải bảo đảm chúng thống nhất giữa yêu cầu gốc và đơn giao, không tạo hai đơn thương mại cho cùng một yêu cầu.

### Key Entities _(include if feature involves data)_

- **Yêu cầu nguyên liệu gốc**: Nguồn của cách tạo từ yêu cầu; xác định trường nhận và toàn bộ nguyên liệu/số lượng/đơn vị, tạo tối đa một đơn.
- **Đơn giao hàng**: Thuộc một nhà cung cấp, bắt buộc một trường nhận; có hai cách tạo; đơn từ yêu cầu có Đã xác nhận sau tiếp nhận, đơn thủ công không có trạng thái này. Sau lưu nguyên liệu cả hai ở Đang chuẩn bị hàng, sau lưu thông tin vận chuyển ở Đang giao hàng. Sau khi lưu nguyên liệu có mã nghiệp vụ và người/thời điểm tạo; biển số xe/thời gian giao dự kiến được bổ sung khi bắt đầu giao. Liên kết yêu cầu gốc có ở đơn từ yêu cầu, không bắt buộc ở đơn độc lập.
- **Dòng đơn**: Một dòng có định danh riêng, nguyên liệu, đơn vị, số lượng, đúng một cơ sở nguồn cung đã chọn và một QR ổn định. Cùng nguyên liệu có nhiều dòng khi cơ sở khác nhau; cặp nguyên liệu–cơ sở nguồn cung không trùng trong một đơn. Với đơn từ yêu cầu, nhiều dòng giao có thể cùng đối chiếu về một dòng yêu cầu gốc và tổng lượng phải bằng đúng lượng dòng gốc đó.
- **Cơ sở nguồn cung**: Cơ sở thuộc riêng một nhà cung cấp, có mã/tên/trạng thái; được chọn lúc tạo dòng và giữ thông tin nguồn đã ghi nhận cho truy xuất lịch sử. Khác với trường nhận hàng.
- **Dãy mã đơn theo nhà cung cấp**: Cấp số tăng cho mã `FP-DE-…` trong từng nhà cung cấp, không dùng chung với dãy mã cơ sở hoặc mã hồ sơ đăng ký.
- **Nhãn QR của dòng đơn**: Một liên kết truy xuất công khai có giới hạn cho đúng dòng/đơn/nguồn; được lấy lại để in, không tương đương định danh riêng cho từng bao bì hoặc quyền kiểm nhận.
- **Quyết định kiểm nhận**: Kết quả đạt/không đạt, vai trò/người/thời điểm và lý do theo chính sách hiện hành; quyết định thuộc riêng từng đơn, không sao chép sang đơn giao lại.
- **Quan hệ nhà cung cấp–trường**: Xác định các trường đủ điều kiện được chọn khi tạo độc lập; phải được kiểm tra lại khi ghi nhận.
- **Người lập đơn**: Admin hoặc staff nhà cung cấp có quyền phù hợp, được ghi nhận từ danh tính hiện hành.
- **Thông tin vận chuyển**: Thời gian giao dự kiến đến trường có múi giờ và biển số xe; cả hai được ghi nhận cùng bước bắt đầu giao, không tự lấy ngày trường mong muốn làm thời gian dự kiến của nhà cung cấp.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Cả admin và staff đủ quyền đều tạo và xem lại được đơn theo cả hai cách; đơn độc lập tạo thành công khi không có yêu cầu nguồn hoặc phiếu bị từ chối.
- **SC-002**: 100% đơn hoàn tất nguyên liệu từ yêu cầu bao phủ đủ dòng yêu cầu gốc và có tổng lượng từng dòng gốc bằng đúng lượng được yêu cầu, kể cả khi phân bổ nhiều nguồn; nguyên liệu/đơn vị không đổi. 100% đơn độc lập có trường nhận đủ điều kiện và nguyên liệu thuộc nhà cung cấp; mỗi dòng ở cả hai cách có một nguồn hợp lệ và QR riêng.
- **SC-003**: 100% tình huống sai quyền/phạm vi hoặc thiếu dữ liệu bắt buộc của bước đang thực hiện bị chặn và giữ nguyên dữ liệu/trạng thái đã hoàn tất; thiếu thông tin vận chuyển không ngăn hoàn tất nguyên liệu nhưng luôn ngăn bắt đầu giao.
- **SC-004**: Sau gửi lại hoặc thao tác đồng thời, mỗi yêu cầu có tối đa một đơn từ yêu cầu; không sinh bản sao từ cùng thao tác ở cả hai cách tạo, nhưng các ý định tạo đơn độc lập riêng biệt vẫn được phép.
- **SC-005**: Tạo đơn độc lập không sửa dữ liệu yêu cầu/phiếu giao cũ, quyết định kiểm nhận hay lịch sử kho trong toàn bộ kịch bản chấp nhận.
- **SC-006**: Với hai nhà cung cấp chưa có mã định dạng mới, mã đầu tiên của mỗi bên là `FP-DE-00001`; trong tình huống ít nhất 20 lần tạo riêng biệt đồng thời ở mỗi bên không có mã trùng trong cùng nhà cung cấp và không có QR trỏ nhầm dòng.
- **SC-007**: Với đơn có N dòng, nhà cung cấp lấy được đúng N QR phân biệt và 100% lần quét bằng thiết bị chưa đăng nhập cho đúng nguyên liệu/nguồn/đơn trong phạm vi công khai; in lại không đổi QR và không lộ trường thông tin ngoài danh sách được phép.
- **SC-008**: 100% yêu cầu tiếp nhận thành công có Đã xác nhận; 100% đơn thủ công không có trạng thái/bước này. Với cả hai cách tạo, lưu đủ nguyên liệu mới Đang chuẩn bị hàng và lưu đủ thời gian/biển số hợp lệ mới Đang giao hàng. Không bỏ bước, lỗi hoặc retry nào làm nhảy/lùi trạng thái; thiếu một trong bốn xác nhận đạt hoặc có không đạt không được hoàn thành/nhập kho.
- **SC-009**: 100% đơn đủ bốn xác nhận đạt và đáp ứng điều kiện nhận hàng được hoàn thành, với đúng một lần ghi nhận kho cho mỗi lô ngay cả khi quyết định cuối được gửi đồng thời hoặc gửi lại.
- **SC-010**: 100% quyết định không đạt hợp lệ thể hiện yêu cầu giao lại và lý do; nhà cung cấp lập được đơn thủ công mới đủ nguồn/QR/thông tin giao mà không dùng lại chữ ký cũ. Lần từ chối thứ ba của cùng yêu cầu vẫn cho kết quả hủy theo chính sách đã xác nhận.
- **SC-011**: Trong mọi kịch bản mở lại sau bước nguyên liệu hoặc mất kết nối sau khi bắt đầu giao, người dùng tiếp tục được từ bước đã lưu, giữ nguyên mã và 100% nguyên liệu/nguồn/QR; không phải lập lại đơn để bổ sung thông tin vận chuyển.
- **SC-012**: Cả admin và staff đủ quyền hoàn tất đúng luồng của từng cách tạo trong kiểm thử chấp nhận: yêu cầu có tiếp nhận/Đã xác nhận, đơn thủ công bắt đầu bằng chọn trường/thêm nguyên liệu; cả hai tiếp tục chuẩn bị rồi giao mà không cần người khác đổi trạng thái hộ. Không đơn thủ công nào phải xin xác nhận với trường hoặc mang nhãn Đã xác nhận trước khi lập đơn.
- **SC-013**: 100% trường hợp hợp lệ ở cả hai cách tạo gồm thịt heo từ A và B được lưu thành hai dòng lượng/nguồn/QR riêng. Với yêu cầu10 kg, phân bổ6+4 kg thành công nhưng tổng9 hoặc11 kg bị chặn. 100% cặp thịt heo–A lặp, kể cả dòng thứ ba/khác lượng, bị chặn trước Đang chuẩn bị hàng; thịt heo–A cùng cà rốt–A vẫn hợp lệ, retry không nhân đôi dòng/QR.
- **SC-014**: 100% kết quả tìm trường thuộc đúng tập linked đủ điều kiện của nhà cung cấp hiện tại, khớp một phần tên hoặc mã không phân biệt hoa/thường và tuân phân trang; các trường hợp không quyền, khác supplier, chưa liên kết hoặc ngừng đủ điều kiện không lộ dữ liệu. Từ khóa rỗng nhận danh sách mặc định, không khớp nhận danh sách trống.

## Assumptions

- Kế thừa hai vai trò admin/staff của nhà cung cấp; mọi thao tác phụ thuộc quyền hiệu lực hiện hành.
- “Thực phẩm” trong yêu cầu được hiểu là nguyên liệu của đơn; “nguồn cung” là cơ sở nguồn cung, không phải trường nhận. Các dòng so sánh cùng nguyên liệu/cơ sở theo đúng thực thể đã chọn, không chỉ theo chuỗi tên hiển thị.
- Tìm trường phục vụ chọn bên nhận khi tạo đơn thủ công, kế thừa điều kiện trường/quan hệ đủ điều kiện của danh sách lựa chọn hiện hành; không mở chức năng tra trường của supplier khác hoặc tra lịch sử quan hệ đã dừng. Tìm theo một phần tên/mã, không phân biệt hoa/thường là mặc định nghiệp vụ của lần bổ sung này; cách tổ chức đường dẫn và tham số giao tiếp được chốt ở bước plan.
- Đơn thủ công không có trạng thái trước khi lưu đủ nguyên liệu và không lưu bản nhập dở; việc bỏ xác nhận ban đầu không bỏ bốn bên kiểm nhận sau khi hàng đến.
- “Thời gian dự kiến” được hiểu là thời gian dự kiến giao đến trường, kế thừa ý nghĩa của thông tin giao hàng hiện có; không phải thời gian dự kiến chuẩn bị xong hoặc thời điểm xuất phát.
- “Thêm nguyên liệu xong” là xác nhận lưu đầy đủ nội dung hợp lệ. Đơn từ yêu cầu được tách dòng theo nguồn và nhập lượng từng phần nhưng phải giữ đủ nguyên liệu, cùng đơn vị và đúng tổng lượng từng dòng yêu cầu gốc. Đơn thủ công cho chọn nguyên liệu/số lượng/nguồn, không bị ràng buộc bởi một yêu cầu không liên quan.
- Chuyển sang Đang giao hàng xảy ra khi lưu thành công đủ cả thời gian dự kiến và biển số xe, không phải ngay khi gõ ký tự cuối của biển số. Nhập/lưu bản dở tự động hoặc sửa bước đã hoàn tất không thuộc phạm vi.
- “Đơn độc lập” là không bắt buộc yêu cầu nguyên liệu/phiếu giao trước; vẫn bắt buộc trường nhận đã liên kết. Không nhầm trường nhận với cơ sở nguồn cung nguyên liệu.
- Trường được chọn tuân thủ chính sách quan hệ hiện hành; mặc định chỉ quan hệ đang ACTIVE đủ điều kiện tạo đơn độc lập mới. Không áp điều kiện này hồi tố để tự thay đổi đơn từ yêu cầu đã tiếp nhận.
- Đơn độc lập không tự động được coi là lần thay thế trong chuỗi giao lại của yêu cầu cũ. Luồng từ yêu cầu tách tiếp nhận/xác nhận, hoàn tất nguyên liệu và bắt đầu giao; luồng thủ công bỏ tiếp nhận/xác nhận, chỉ chọn trường/thêm nguyên liệu rồi chuẩn bị và bắt đầu giao; vẫn bắt buộc nguồn/QR khi lưu nguyên liệu và thông tin vận chuyển khi bắt đầu giao. Giữ bốn bên kiểm nhận, điều kiện nhận hàng và chính sách giao lại đã xác nhận; gắn đơn thủ công vào chuỗi cũ cần yêu cầu riêng.
- Cách lưu đơn không có yêu cầu nguồn và cách đưa loại đơn này vào luồng giao/kiểm nhận là phần thiết kế phải xử lý rõ ở bước plan, dựa trên đối tượng bắt buộc là trường nhận và dòng nguyên liệu; không được tạo yêu cầu giả hoặc thay quy tắc hiện hành ngoài phạm vi.
- Phạm vi sửa đổi là luồng nghiệp vụ trước khi giao của hai cách tạo, trạng thái hiển thị và bước tiếp theo. Các chức năng nguồn cung, mã theo nhà cung cấp, QR/truy xuất và kiểm nhận kế thừa đặc tả trước. Không bổ sung sửa/xóa nội dung đơn đã hoàn tất nguyên liệu, theo dõi xe trực tiếp, báo giá, thuế, thanh toán, hóa đơn hoặc định danh từng bao bì. Bố cục màn hình, nhãn chuyên biệt, định dạng tệp in và tích hợp máy in chưa được yêu cầu.
- Một nguyên liệu được xuất hiện nhiều dòng trong cùng đơn khi mỗi dòng chọn cơ sở nguồn cung khác nhau; mỗi dòng có số lượng và QR riêng. Đây là nhiều dòng nguyên liệu trong cùng một đơn, không phải chia thành nhiều đơn hoặc quản lý định danh riêng từng bao bì.
- Quy tắc nhiều dòng cùng nguyên liệu khác nguồn áp dụng cho cả hai cách tạo. Đơn từ yêu cầu được phân bổ một dòng yêu cầu gốc sang nhiều dòng giao trong cùng đơn, mỗi dòng có lượng dương, cùng nguyên liệu/đơn vị nguồn và nguồn cung khác nhau; tổng lượng của các dòng phân bổ phải đúng lượng yêu cầu gốc.
- Nguồn đã ghi nhận gồm ít nhất định danh cơ sở và tên/mã tại lúc hoàn tất nguyên liệu; không công khai thông tin liên hệ cá nhân. Nhiều lô của cùng dòng nếu được lập theo luồng nhận hàng đều phải giữ cùng nguồn. Dừng cơ sở chỉ ngăn lựa chọn mới, không phá nguồn đã ghi nhận ở bước chuẩn bị hoặc giao hàng.
- “Hoàn thành” là kết quả đã nhận hàng thành công sau bốn xác nhận đạt, không phải chỉ bắt đầu vận chuyển hoặc riêng một lần quét QR. Hàng phải đến trường trước kiểm nhận; bước plan cần mô tả rõ cách ghi nhận đến nơi và các dữ liệu lô cần thiết, không cho kiểm nhận khi chưa đến.
- Mã đơn theo nhà cung cấp có thể trùng giữa các bên, còn định danh riêng của đơn và QR không được nhầm lẫn. Không thay đổi cách cấp mã cơ sở `FP-SF-…` đã xác nhận.
- Chỉ cập nhật đặc tả và trạng thái tài liệu thiết kế ở bước này; chưa triển khai tính năng, đổi dữ liệu/schema, chạy migration hoặc tạo dữ liệu mẫu.
