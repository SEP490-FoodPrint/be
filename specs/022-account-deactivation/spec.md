# Feature Specification: Vô hiệu hóa tài khoản và tạm dừng tiếp nhận công việc

**Feature Branch**: `feat/022-account-deactivation`

**Created**: 2026-11-11

**Status**: Đã triển khai và kiểm chứng trên PostgreSQL disposable — chưa deploy database vận hành

**Input**: User description: "Vô hiệu hóa admin school, supplier chỉ khi cả hai tổ chức không có đơn đặt nguyên liệu đang diễn ra; vô hiệu hóa mọi tài khoản trực thuộc tổ chức đó. Cán bộ an toàn thực phẩm cấp xã chỉ được vô hiệu hóa khi không có yêu cầu kiểm tra ngộ độc từ nhà trường."

## Clarifications

### Session 2026-11-12

- Q: Khóa admin có ảnh hưởng những tài khoản nào? → A: Áp dụng cho cả admin trường và admin nhà cung cấp; khóa admin cùng mọi thành viên trong tổ chức đó khi không còn đơn đang diễn ra. Phạm vi được hiểu theo từng tổ chức có admin được chọn, không tự khóa đối tác.
- Q: Đơn đang diễn ra là trạng thái nào? → A: Chỉ đơn IN_PROGRESS ngăn vô hiệu hóa; không thêm điều kiện chặn riêng theo chuyến giao.
- Q: Khi nào được khóa cán bộ ATTP xã? → A: Chỉ được khóa khi không có yêu cầu từ trường gửi tới cán bộ được chỉ định hoặc tất cả yêu cầu đều CLOSED; chỉ một yêu cầu chưa CLOSED cũng ngăn khóa.
- Q: Cần bổ sung tạm dừng hoạt động như thế nào? → A: Có tạm dừng cho trường để ngăn tạo đơn mới, cho nhà cung cấp để ngăn tiếp nhận đơn phục vụ kiểm tra ngộ độc, và cho cán bộ ATTP xã để ngăn nhận yêu cầu kiểm tra mới. Nhà cung cấp có trạng thái tạm dừng do kiểm tra ngộ độc liên quan bữa ăn do mình cung cấp thực phẩm. System Admin chủ động bật/gỡ tạm dừng; tạm dừng ATTP áp dụng riêng tài khoản cán bộ được chỉ định; công việc đã nhận được tiếp tục xử lý, còn việc gửi/tiếp nhận chưa hoàn tất bị chặn trong thời gian tạm dừng.
- Q: Ai được bật và gỡ tạm dừng hoạt động của trường, nhà cung cấp và cán bộ ATTP xã? → A: System Admin chủ động bật/gỡ cho cả ba đối tượng; không tự áp dụng hoặc tự gỡ theo tiến độ kiểm tra.
- Q: Tạm dừng tiếp nhận yêu cầu kiểm tra ngộ độc áp dụng cho từng cán bộ hay toàn đơn vị ATTP xã? → A: Chỉ áp dụng tài khoản cán bộ được chỉ định. Cán bộ ATTP xã chỉ có một tài khoản, không có mô hình tổ chức gồm admin và thành viên như trường/nhà cung cấp.
- Q: Trong thời gian tạm dừng, các đơn hàng và yêu cầu kiểm tra có từ trước được tiếp tục xử lý đến mức nào? → A: Tiếp tục xử lý đơn/yêu cầu đã nhận; không gửi đơn nháp, không nhận đơn SENT hoặc yêu cầu chưa nhận, kể cả được tạo trước lúc tạm dừng.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Vô hiệu hóa admin và mọi tài khoản trực thuộc (Priority: P1)

Quản trị viên hệ thống có quyền muốn vô hiệu hóa admin của trường hoặc nhà cung cấp đủ điều kiện, đồng thời ngăn mọi tài khoản trực thuộc tổ chức tiếp tục sử dụng hệ thống.

**Why this priority**: Đây là hành vi chính và phải bảo đảm không bỏ sót tài khoản trực thuộc.

**Independent Test**: Chuẩn bị riêng trường và nhà cung cấp đủ điều kiện, mỗi bên có admin và nhiều tài khoản; thực hiện vô hiệu hóa từng admin rồi đối chiếu toàn bộ tài khoản.

**Acceptance Scenarios**:

1. **Given** admin trường đang hoạt động và đủ điều kiện FR-003/FR-004, **When** người có thẩm quyền vô hiệu hóa admin, **Then** admin và mọi tài khoản hiện trực thuộc trường cùng bị vô hiệu hóa.
2. **Given** admin nhà cung cấp đang hoạt động và đủ điều kiện, **When** thực hiện tương tự, **Then** admin và mọi tài khoản hiện trực thuộc nhà cung cấp cùng bị vô hiệu hóa.
3. **Given** tổ chức có tài khoản đang hoạt động, đã khóa và đã vô hiệu hóa, **When** thao tác thành công, **Then** tất cả đều ở trạng thái vô hiệu hóa, không tài khoản nào được kích hoạt lại.
4. **Given** tổ chức có nhiều đối tác liên kết, **When** vô hiệu hóa admin thành công, **Then** không thay đổi tài khoản của đối tác hoặc tổ chức khác, không khóa đồng thời theo cặp trường–nhà cung cấp.
5. **Given** có lỗi trước khi hoàn tất thay đổi toàn bộ tài khoản, **When** thao tác kết thúc, **Then** không lưu thay đổi một phần và không thông báo thành công.

---

### User Story 2 - Ngăn vô hiệu hóa khi còn đơn nguyên liệu đang diễn ra (Priority: P1)

Quản trị viên hệ thống cần biết vì sao không thể vô hiệu hóa admin khi còn đơn nguyên liệu IN_PROGRESS.

**Why this priority**: Tránh gián đoạn việc xử lý đơn của trường và nhà cung cấp.

**Independent Test**: Với từng phạm vi và trạng thái được xác nhận tại FR-003/FR-004, thử vô hiệu hóa và đối chiếu kết quả cùng trạng thái mọi tài khoản.

**Acceptance Scenarios**:

1. **Given** tổ chức có ít nhất một đơn IN_PROGRESS, **When** vô hiệu hóa admin, **Then** bị từ chối với lý do tiếng Việt và mọi tài khoản giữ nguyên trạng thái.
2. **Given** tổ chức không có đơn IN_PROGRESS, **When** người có thẩm quyền vô hiệu hóa admin, **Then** thao tác thành công theo User Story 1.
3. **Given** đơn đang diễn ra nằm ngoài phạm vi kiểm tra đã xác nhận, **When** vô hiệu hóa admin đủ điều kiện, **Then** đơn đó không ngăn thao tác.
4. **Given** một đơn chuyển sang trạng thái chặn đồng thời với thao tác vô hiệu hóa, **When** xử lý cả hai, **Then** không cho phép cả hai cùng thành công nếu kết quả vi phạm điều kiện vô hiệu hóa.

---

### User Story 3 - Vô hiệu hóa Cán bộ ATTP xã (Priority: P1)

Quản trị viên hệ thống có quyền muốn vô hiệu hóa cán bộ ATTP xã khi không còn yêu cầu kiểm tra ngộ độc thuộc phạm vi phải giải quyết.

**Why this priority**: Bảo đảm yêu cầu kiểm tra từ trường không bị bỏ dở vì tài khoản bị khóa.

**Independent Test**: Chuẩn bị cán bộ có và không có yêu cầu chặn theo FR-007; thử vô hiệu hóa, kiểm tra tài khoản đích và tài khoản cán bộ xã khác.

**Acceptance Scenarios**:

1. **Given** cán bộ đang hoạt động, không có yêu cầu chặn theo FR-007 và người thực hiện có quyền, **When** vô hiệu hóa, **Then** chỉ tài khoản cán bộ được chọn bị vô hiệu hóa.
2. **Given** còn ít nhất một yêu cầu chặn, **When** vô hiệu hóa, **Then** bị từ chối với lý do tiếng Việt, tài khoản giữ nguyên trạng thái.
3. **Given** yêu cầu được gửi tới cán bộ xã khác hoặc tất cả yêu cầu gửi tới cán bộ được chọn đều CLOSED, **When** vô hiệu hóa cán bộ đủ điều kiện, **Then** yêu cầu đó không ngăn thao tác.
4. **Given** hai tài khoản cán bộ của hai xã khác nhau, **When** vô hiệu hóa một người thành công, **Then** không thay đổi người còn lại hoặc tài khoản trường gửi yêu cầu.

---

### User Story 4 - Giới hạn quyền quản trị và hiệu lực khóa tài khoản (Priority: P1)

Chỉ người có thẩm quyền được vô hiệu hóa; tài khoản đã vô hiệu hóa không thể tiếp tục sử dụng bằng phiên cũ hoặc đăng nhập lại.

**Why this priority**: Hiệu lực khóa và giới hạn quyền là điều kiện bắt buộc của tính năng.

**Independent Test**: Thử các vai trò và quyền khác nhau; sau khi khóa, thử đăng nhập, gia hạn phiên và dùng phiên cũ của từng nhóm tài khoản bị ảnh hưởng.

**Acceptance Scenarios**:

1. **Given** người thực hiện không phải System Admin hoặc thiếu quyền quản lý tài khoản hiệu lực, **When** yêu cầu vô hiệu hóa, **Then** bị từ chối, không thay đổi tài khoản nào.
2. **Given** tài khoản đã vô hiệu hóa có phiên chưa hết hạn, **When** thực hiện yêu cầu nghiệp vụ tiếp theo, **Then** bị từ chối; đăng nhập và gia hạn phiên cũng không cấp quyền truy cập mới.
3. **Given** người thực hiện bị thu hồi quyền trước khi thao tác hoàn tất, **When** kiểm tra lại quyền, **Then** từ chối toàn bộ thao tác.

Các kịch bản bổ sung về tạm dừng hoạt động (thuộc User Story 1 và 3):

1. **Given** trường đang tạm dừng, **When** bất kỳ tài khoản nào thuộc trường tạo đơn nguyên liệu mới, **Then** bị từ chối với lý do tiếng Việt.
2. **Given** nhà cung cấp đang tạm dừng để kiểm tra ngộ độc liên quan thực phẩm đã cung cấp, **When** admin hoặc thành viên tiếp nhận một đơn mới, **Then** bị từ chối.
3. **Given** cán bộ ATTP xã đang tạm dừng tiếp nhận yêu cầu, **When** có yêu cầu kiểm tra mới được chuyển tới phạm vi đang tạm dừng, **Then** không được tiếp nhận vào tài khoản cán bộ đó; không làm tạm dừng tài khoản cán bộ xã khác.
4. **Given** tài khoản vẫn hoạt động nhưng đang áp dụng tạm dừng tiếp nhận công việc, **When** đăng nhập và xem dữ liệu được phép, **Then** vẫn sử dụng được để phục vụ kiểm tra; không coi tạm dừng là vô hiệu hóa tài khoản.
5. **Given** tổ chức còn đơn IN_PROGRESS hoặc cán bộ còn yêu cầu chưa CLOSED, **When** áp dụng tạm dừng, **Then** việc tạm dừng không đòi hỏi phải đủ điều kiện vô hiệu hóa và không tự hủy công việc đang có.
6. **Given** System Admin có quyền quản lý hiệu lực, **When** chủ động bật hoặc gỡ tạm dừng cho một đối tượng, **Then** giới hạn tiếp nhận tương ứng có hiệu lực hoặc được gỡ; tài khoản đã vô hiệu hóa không được kích hoạt lại.
7. **Given** người dùng không phải System Admin hoặc thiếu quyền quản lý hiệu lực, **When** bật/gỡ tạm dừng, **Then** thao tác bị từ chối và trạng thái giữ nguyên.
8. **Given** kiểm tra bắt đầu hoặc kết thúc nhưng System Admin chưa thay đổi tạm dừng, **When** xem trạng thái tiếp nhận, **Then** trạng thái tạm dừng không tự thay đổi.

9. **Given** trường đã có bản nháp trước khi tạm dừng, **When** gửi bản nháp trong thời gian tạm dừng, **Then** bị từ chối và đơn giữ DRAFT.
10. **Given** nhà cung cấp đã có đơn SENT trước khi tạm dừng, **When** tiếp nhận đơn trong thời gian tạm dừng, **Then** bị từ chối và đơn giữ SENT.
11. **Given** đơn đã ACCEPTED/IN_PROGRESS hoặc cán bộ đã tiếp nhận yêu cầu trước lúc tạm dừng, **When** người có quyền tiếp tục xử lý, **Then** được phép theo vòng đời hiện hành, bao gồm hoàn tất đơn hoặc đóng yêu cầu.
12. **Given** yêu cầu kiểm tra đã được tạo nhưng chưa tiếp nhận trước lúc cán bộ tạm dừng, **When** tiếp nhận yêu cầu, **Then** bị từ chối, không tự đóng hoặc hủy yêu cầu.
13. **Given** System Admin gỡ tạm dừng và tài khoản vẫn hoạt động, **When** người có quyền chủ động gửi/tiếp nhận công việc đang chờ, **Then** được phép nếu thỏa điều kiện nghiệp vụ hiện hành; việc gỡ tạm dừng không tự thực hiện các thao tác này.

### Edge Cases

- Tổ chức chỉ có admin: vô hiệu hóa chính admin nếu đủ điều kiện.
- Đích không tồn tại, sai vai trò, thiếu tổ chức hoặc đổi tổ chức trước khi hoàn tất: từ chối, không sửa tài khoản khác.
- Gọi lại với tài khoản đích đã vô hiệu hóa và toàn bộ tài khoản thuộc phạm vi cũng đã vô hiệu hóa: trả kết quả đã vô hiệu hóa, không tạo thay đổi mới. Nếu admin đã vô hiệu hóa nhưng tổ chức còn tài khoản chưa vô hiệu hóa, báo xung đột, không báo thành công giả.
- Hai yêu cầu vô hiệu hóa đồng thời: kết quả nhất quán, không tác động trùng lặp hoặc lưu thay đổi một phần.
- Thêm/chuyển tài khoản đồng thời: không để lại tài khoản hoạt động trong tổ chức sau lần vô hiệu hóa admin thành công; không khóa tài khoản ngoài phạm vi đã xác nhận.
- Một đơn IN_PROGRESS cũng đủ ngăn vô hiệu hóa admin; trạng thái chuyến giao không phải điều kiện chặn riêng. Một yêu cầu OPEN, INVESTIGATING hoặc RESOLVED gửi tới cán bộ được chọn cũng đủ ngăn vô hiệu hóa; chuyển tiếp trùng không làm đổi điều kiện.
- Tổ chức hoặc cán bộ đang tạm dừng vẫn có thể được vô hiệu hóa khi thỏa điều kiện tương ứng; tạm dừng không được dùng để bỏ qua kiểm tra.
- Mọi tài khoản của cùng trường/nhà cung cấp đều chịu giới hạn tạm dừng của tổ chức, không thể dùng tài khoản thành viên khác để vượt giới hạn.
- Tạm dừng đồng thời với tạo/tiếp nhận công việc mới phải cho kết quả nhất quán; không để công việc mới được tiếp nhận sau khi tạm dừng đã có hiệu lực.
- Bật/gỡ tạm dừng lặp lại cùng trạng thái có kết quả nhất quán, không tạo công việc hoặc kích hoạt lại tài khoản.
- Tuổi của đơn/yêu cầu không phải điều kiện miễn trừ tạm dừng: công việc chưa gửi/nhận vẫn bị chặn dù được tạo trước; công việc đã nhận vẫn tiếp tục theo vòng đời hiện hành.
- Lỗi khi kiểm tra điều kiện không được hiểu là không có công việc; không đổi trạng thái tài khoản.
- Thông báo từ chối không tiết lộ dữ liệu ngoài quyền xem của người thực hiện.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST hỗ trợ ba vai trò đích: Quản trị viên Nhà trường (`SCHOOL_ADMINISTRATION`), Quản trị viên Nhà cung cấp Nguyên liệu (`INGREDIENT_SUPPLIER_ADMIN`), Cán bộ ATTP xã (`COMMUNE_FOOD_SAFETY_OFFICER`). Không mở rộng thành chức năng vô hiệu hóa tùy ý mọi vai trò.
- **FR-002**: Người thực hiện MUST là System Admin đang hoạt động, thuộc tổ chức hệ thống, có quyền quản lý tài khoản hiệu lực. MUST kiểm tra lại quyền, vai trò và tổ chức hiện hành của người thực hiện cùng tài khoản đích trước khi hoàn tất; không có quyền mặc định chỉ vì là quản trị viên.
- **FR-003**: Admin trường hoặc nhà cung cấp MUST chỉ được vô hiệu hóa khi tổ chức có admin được chọn không có đơn IN_PROGRESS. Quy tắc áp dụng cho cả hai loại tổ chức, xét mọi đơn của tổ chức đích với mọi đối tác; không tự khóa tài khoản đối tác.
- **FR-004**: Chỉ trạng thái đơn IN_PROGRESS MUST được coi là đang diễn ra khi xét vô hiệu hóa. DRAFT, SENT, ACCEPTED, COMPLETED và CANCELLED không chặn theo trạng thái đơn; không bổ sung kiểm tra chặn riêng theo trạng thái chuyến giao.
- **FR-005**: Vô hiệu hóa admin tổ chức thành công MUST chuyển admin cùng mọi tài khoản hiện trực thuộc tổ chức trong phạm vi khóa đã xác nhận sang trạng thái vô hiệu hóa, kể cả tài khoản đã không hoạt động hoặc đang khóa. MUST xác định tài khoản liên quan từ tổ chức thực tế của đích, không cho người thực hiện tự chọn danh sách để bỏ sót tài khoản.
- **FR-006**: Kiểm tra điều kiện và vô hiệu hóa nhóm tài khoản MUST toàn bộ thành công hoặc toàn bộ không thay đổi. MUST không thay đổi tài khoản ngoài phạm vi, không xóa tài khoản, lịch sử, vai trò, quyền đã gán hoặc quan hệ tổ chức.
- **FR-007**: Cán bộ ATTP xã MUST chỉ được vô hiệu hóa khi không có yêu cầu kiểm tra ngộ độc từ trường gửi tới chính cán bộ được chỉ định hoặc tất cả yêu cầu đã CLOSED. OPEN, INVESTIGATING và RESOLVED đều chặn; một yêu cầu chưa CLOSED cũng đủ để từ chối.
- **FR-008**: Vô hiệu hóa cán bộ đủ điều kiện MUST chỉ tác động tài khoản được chọn, không lan sang cán bộ khác hoặc tài khoản trường gửi yêu cầu.
- **FR-009**: Mọi tài khoản bị vô hiệu hóa MUST không thể đăng nhập, gia hạn phiên hoặc thực hiện yêu cầu nghiệp vụ tiếp theo bằng phiên đã có. Không yêu cầu dừng hồi tố công việc đã hoàn tất trước thời điểm vô hiệu hóa.
- **FR-010**: Hệ thống MUST ngăn các thao tác đồng thời cùng thành công khiến điều kiện đơn/yêu cầu bị vi phạm hoặc bỏ sót tài khoản trực thuộc. Nếu không bảo đảm được điều kiện, MUST từ chối và cho phép quản trị viên thử lại.
- **FR-011**: Kết quả MUST cho biết thành công hoặc từ chối; nếu bị chặn bởi công việc chưa kết thúc, MUST nêu loại công việc bằng tiếng Việt. Không báo thành công khi lỗi kiểm tra hoặc xử lý.
- **FR-012**: Thao tác lặp MUST an toàn theo Edge Cases; không tự kích hoạt tài khoản, hủy/hoàn tất đơn hoặc yêu cầu kiểm tra để vượt điều kiện.
- **FR-013**: MUST bảo toàn lịch sử và khả năng tra cứu của người còn quyền; không tạo admin thay thế hoặc xóa liên kết để né giới hạn một admin mỗi tổ chức.
- **FR-014**: Hệ thống MUST hỗ trợ trạng thái tạm dừng hoạt động để phục vụ kiểm tra, độc lập với trạng thái vô hiệu hóa tài khoản. Tài khoản còn hoạt động MUST vẫn đăng nhập và truy cập dữ liệu theo quyền hiện hành; tạm dừng không tự khóa admin/thành viên và không hủy công việc đang có.
- **FR-015**: Trường đang tạm dừng MUST không tạo được đơn nguyên liệu mới qua bất kỳ tài khoản hoặc luồng tạo đơn nào của trường. Nhà cung cấp đang tạm dừng MUST không tiếp nhận đơn mới qua bất kỳ tài khoản hoặc luồng tiếp nhận nào của nhà cung cấp.
- **FR-016**: Nhà cung cấp MUST có thể mang trạng thái “Tạm dừng do kiểm tra ngộ độc thực phẩm” khi có đoàn kiểm tra bữa ăn có học sinh bị ngộ độc liên quan thực phẩm nhà cung cấp đã cung cấp. Chỉ System Admin đang hoạt động, thuộc tổ chức hệ thống và có quyền quản lý hiệu lực mới được chủ động bật/gỡ tạm dừng cho trường, nhà cung cấp và cán bộ ATTP xã. Hệ thống MUST kiểm tra lại quyền trước khi hoàn tất; không tự bật/gỡ theo trạng thái kiểm tra.
- **FR-017**: Tạm dừng tiếp nhận yêu cầu kiểm tra mới MUST gắn với đúng tài khoản cán bộ ATTP xã được System Admin chỉ định. Mỗi xã chỉ có một tài khoản cán bộ ATTP; MUST không tổ chức thành nhóm admin/thành viên và không áp dụng tạm dừng theo một nhóm tài khoản. Tài khoản cán bộ xã khác MUST không bị ảnh hưởng.
- **FR-018**: Tạm dừng MUST có quy tắc khôi phục tiếp nhận và xử lý các đơn/yêu cầu có trước thời điểm tạm dừng. Chỉ System Admin được gỡ tạm dừng; gỡ tạm dừng MUST không kích hoạt lại tài khoản đã vô hiệu hóa. Trong thời gian tạm dừng, đơn đã ACCEPTED/IN_PROGRESS và yêu cầu đã tiếp nhận MUST được tiếp tục xử lý theo quyền và vòng đời hiện hành. Trường tạm dừng MUST không gửi đơn DRAFT, kể cả bản nháp cũ; nhà cung cấp tạm dừng MUST không nhận đơn SENT, kể cả đơn gửi từ trước; cán bộ tạm dừng MUST không nhận yêu cầu chưa tiếp nhận, kể cả yêu cầu tạo từ trước. Gỡ tạm dừng MUST chỉ khôi phục khả năng thao tác theo quyền hiện hành, không tự gửi hoặc tiếp nhận công việc đang chờ.
- **FR-019**: Tạm dừng MUST áp dụng nhất quán cho mọi tài khoản và luồng ghi thuộc phạm vi; không cho phép thao tác đồng thời tạo/tiếp nhận mới vượt qua thời điểm tạm dừng đã có hiệu lực. Lỗi kiểm tra trạng thái MUST không cho phép bỏ qua giới hạn.

### Key Entities _(include if feature involves data)_

- **Tài khoản đích**: Một trong ba vai trò được phép vô hiệu hóa. Admin trường/nhà cung cấp có tổ chức sở hữu; cán bộ ATTP xã là một tài khoản riêng cho xã đó, không có tài khoản thành viên trực thuộc.
- **Tổ chức trường/nhà cung cấp**: Đơn vị sở hữu admin và các tài khoản chịu tác động dây chuyền.
- **Đơn nguyên liệu**: Công việc giữa trường và nhà cung cấp; chỉ IN_PROGRESS ngăn vô hiệu hóa admin. Trạng thái chuyến giao không phải điều kiện chặn riêng.
- **Trạng thái tạm dừng tiếp nhận**: Giới hạn tạo đơn của trường, tiếp nhận đơn của nhà cung cấp hoặc tiếp nhận yêu cầu kiểm tra của cán bộ; nhà cung cấp có trạng thái tạm dừng do kiểm tra ngộ độc. Độc lập với vô hiệu hóa tài khoản.
- **Yêu cầu kiểm tra ngộ độc**: Yêu cầu từ trường liên quan sự cố an toàn thực phẩm, có tiến độ xử lý và cán bộ được chỉ định tiếp nhận. Việc ngăn vô hiệu hóa và ngăn nhận mới xét đúng cán bộ đó.
- **Cán bộ ATTP xã**: Một xã có một tài khoản cán bộ; không mô hình hóa tổ chức có admin/thành viên như trường hoặc nhà cung cấp.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Trong 100% kịch bản trường/nhà cung cấp đủ điều kiện, toàn bộ tài khoản thuộc phạm vi khóa bị vô hiệu hóa sau một thao tác thành công; số tài khoản ngoài phạm vi bị thay đổi bằng 0.
- **SC-002**: 100% kịch bản còn đơn hoặc yêu cầu thuộc nhóm chặn đều bị từ chối với lý do đúng; không tài khoản nào bị thay đổi.
- **SC-003**: Trong 100% kịch bản cán bộ đủ điều kiện, chỉ đúng cán bộ được chọn bị vô hiệu hóa; cán bộ khác và tài khoản trường giữ nguyên.
- **SC-004**: 100% tài khoản bị vô hiệu hóa bị từ chối ở lần đăng nhập, gia hạn phiên và yêu cầu nghiệp vụ tiếp theo, kể cả khi dùng phiên cũ.
- **SC-005**: Toàn bộ kịch bản thiếu quyền, lỗi giữa chừng, thao tác lặp và thao tác đồng thời không có trường hợp sửa trái phép, vô hiệu hóa một phần hoặc báo thành công khi điều kiện chưa bảo đảm.
- **SC-006**: Trong 100% tình huống trường tạm dừng tạo đơn và nhà cung cấp tạm dừng tiếp nhận đơn, thao tác mới tương ứng bị từ chối qua mọi tài khoản thuộc tổ chức; tài khoản đang hoạt động vẫn đăng nhập và tra cứu theo quyền.
- **SC-007**: Trong 100% tình huống tạm dừng tiếp nhận yêu cầu kiểm tra, không có yêu cầu mới được tiếp nhận vào tài khoản cán bộ đang tạm dừng; tài khoản cán bộ xã khác không bị ảnh hưởng; không tự đóng hoặc hủy yêu cầu đang có.
- **SC-008**: Trong 100% kịch bản công việc có từ trước lúc tạm dừng, gửi đơn DRAFT, nhận đơn SENT và nhận yêu cầu chưa tiếp nhận đều bị từ chối; công việc đã nhận vẫn được xử lý đến hoàn tất theo quyền hiện hành. Gỡ tạm dừng không tự gửi/nhận công việc và không kích hoạt lại tài khoản đã vô hiệu hóa.

## Assumptions

- Người thực hiện vô hiệu hóa tài khoản là System Admin có `user.manage`, kế thừa chính sách quản trị tài khoản toàn hệ thống trong [AUTHORIZATION.md](../../docs/AUTHORIZATION.md). Admin tổ chức và cán bộ không được thực hiện vô hiệu hóa tài khoản trong phạm vi này. System Admin chủ động bật/gỡ tạm dừng cho cả ba đối tượng; quyền quản lý hiệu lực dùng `user.manage` theo cùng phạm vi quản trị, không có bypass theo vai trò.
- “Vô hiệu hóa” được hiểu là trạng thái tài khoản `DEACTIVATED` đã có, khác với khóa tạm thời. Không xóa dữ liệu và không cung cấp kích hoạt lại trong phạm vi tính năng.
- Phạm vi được mở rộng ngày 2026-11-12: bổ sung tạm dừng tạo/tiếp nhận công việc để phục vụ kiểm tra. Đây là giới hạn nghiệp vụ của hệ thống, không suy diễn thành đình chỉ hoạt động pháp nhân. Trạng thái tạm dừng độc lập với vô hiệu hóa tài khoản.
- Dữ liệu hiện có liên kết tài khoản và báo cáo qua định danh đơn vị ATTP xã. Bước lập kế hoạch phải đối chiếu liên kết này để xác định đúng tài khoản nhận và bảo đảm quy tắc một tài khoản cán bộ mỗi xã; giữ định danh và dữ liệu lịch sử, không tự xóa mô hình hoặc chuyển dữ liệu trong bước làm rõ. Không bổ sung chức năng tạo nhóm cán bộ hay phân công giữa nhiều tài khoản trong một xã.
- Phụ thuộc xác thực, quản trị tài khoản, trạng thái đơn/giao hàng và chuyển tiếp sự cố hiện có. Không mở rộng toàn bộ vòng đời xử lý đơn hoặc điều tra ngộ độc ngoài các điều kiện chặn tạo/tiếp nhận đã nêu; không bổ sung gửi thông báo, nhật ký nghiệp vụ mới hoặc giao diện mới trong tính năng này. Bước đặc tả không thay đổi dữ liệu đang vận hành.
