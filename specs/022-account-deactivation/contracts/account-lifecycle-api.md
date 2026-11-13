# HTTP contracts: account lifecycle và tiếp nhận

Base `/api`. Dùng session cookie hoặc Bearer được hỗ trợ hiện tại, CSRF header `X-CSRF-Protection: 1` cho request ghi theo cấu hình hiện hành. Các route mới không dùng namespace `/api/v1`, giữ envelope hiện có.

## Quy tắc chung

- Thành công: `{ success: true, statusCode, message, data }` qua sendSuccess.
- Lỗi: `{ success: false, statusCode, message, error? }` qua sendError; không thêm trường `errors` hoặc mã lỗi v1 vào route thường.
- Mọi params/body/query qua Zod strictObject và safeParse. Action body nhận `{}` hoặc body vắng được chuẩn hóa `{}`; từ chối null, mảng, trường lạ. Route không có query nhận strict object rỗng.
- UUID sai: 400; thiếu/sai phiên: 401; thiếu quyền/sai loại actor: 403; tài nguyên không tồn tại/ngoài scope: 404; xung đột trạng thái hoặc bị tạm dừng: 409; hạ tầng lỗi: 503. Lỗi tiếng Việt không lộ dữ liệu request thô, secret hoặc Prisma error.
- Date ISO 8601; các response dưới đây là allowlist, không trả User/Prisma record trực tiếp.

## 1. Đọc trạng thái quản trị

`GET /api/users/:userId/lifecycle`

Chỉ SYSTEM_ADMIN thuộc SYSTEM có user.manage. Chấp nhận đúng ba role đích; không có endpoint GET liệt kê mới. ID không có membership hợp lệ hoặc role khác trả 409, không suy diễn scope từ body/query.

Data:

| Trường        | Kiểu                                                | Ý nghĩa                                        |
| ------------- | --------------------------------------------------- | ---------------------------------------------- |
| userId        | UUID                                                | Tài khoản được chọn                            |
| roleCode      | string                                              | Một trong ba role đích                         |
| accountStatus | AccountStatus                                       | Trạng thái hiện hành                           |
| targetType    | SCHOOL / SUPPLIER / OFFICER                         | Phạm vi tạm dừng/cascade                       |
| intakeState   | ACTIVE / PAUSED / PAUSED_FOR_FOOD_SAFETY_INSPECTION | Trạng thái tiếp nhận mới                       |
| updatedAt     | ISO string                                          | Thời điểm cập nhật của entity chứa intakeState |

Không bắt buộc thêm preview “được khóa hay không”; quyết định cuối luôn kiểm tra lại khi ghi. Không trả danh sách đơn/yêu cầu bị chặn.

## 2. Vô hiệu hóa

`POST /api/users/:userId/deactivate`, body `{}`.

Quyền như mục 1; service recheck actor/target trong transaction. Admin kéo theo mọi user cùng school/supplier; officer chỉ đích. Chặn admin chỉ với IN_PROGRESS; officer với bất kỳ request chưa CLOSED, kể cả chưa receive hoặc gửi thông báo FAILED/PENDING. Không nhận organizationId, role, status, thành viên hoặc cờ bỏ qua điều kiện từ client.

200 data: `{ userId, targetType, status: "DEACTIVATED", affectedAccountCount }`.

`affectedAccountCount` là tổng tài khoản thuộc phạm vi tại thời điểm kết quả, gồm tài khoản vốn đã DEACTIVATED, để gọi lặp cho kết quả có nghĩa ổn định; không phải số hàng changed. Gọi lặp hợp lệ không đổi timestamps. Nếu admin đã DEACTIVATED nhưng còn thành viên chưa DEACTIVATED trả 409, không tự sửa trạng thái nửa chừng.

Thông báo chặn: “Không thể vô hiệu hóa vì tổ chức còn đơn hàng IN_PROGRESS.” hoặc “Không thể vô hiệu hóa vì cán bộ còn yêu cầu kiểm tra chưa CLOSED.” Không trả thông tin đối tác/yêu cầu ngoài scope.

## 3. Bật/gỡ tạm dừng

`PATCH /api/users/:userId/intake-state`

Quyền như mục 1. Body strict `{ "state": "..." }`, bắt buộc đúng một trường. Giá trị hợp lệ phụ thuộc đích:

| Đích         | state nhận vào                             | Dữ liệu được ghi     |
| ------------ | ------------------------------------------ | -------------------- |
| Admin trường | ACTIVE / PAUSED                            | School.intakeState   |
| Admin NCC    | ACTIVE / PAUSED_FOR_FOOD_SAFETY_INSPECTION | Supplier.intakeState |
| Cán bộ xã    | ACTIVE / PAUSED                            | User.intakeState     |

Giá trị không hợp lệ cho loại đích trả 400. Không yêu cầu người quản trị cung cấp danh sách học sinh, incidentId hoặc bằng chứng chưa được spec xác nhận. Trạng thái kiểm tra là lý do nghiệp vụ được System Admin quyết định, không tự kích hoạt từ incident.

200 data giống mục 1. Gọi lặp cùng state không ghi. Cho phép gỡ/bật state dù tài khoản đã DEACTIVATED nhưng accountStatus vẫn DEACTIVATED, không tạo quyền truy cập mới. Không tự gửi DRAFT, nhận SENT hoặc nhận report khi resume.

## 4. Các API tạo/gửi đơn hiện có

Giữ `POST /api/supply-requests` và `POST /api/supply-requests/:id/send` do supplier-onboarding router sở hữu. Không đăng ký trùng route trong module supply-order.

Giữ body create đã được source chấp nhận: supplierId, requestNo, requestedDeliveryDate, items gồm ingredientEntryId/quantity; giữ giới hạn 1–100 dòng, quantity dương tối đa 1e9 với tối đa ba chữ số thập phân và mọi normalization hiện hành. Giữ body send `{ contractId }`, hợp đồng/quan hệ ACTIVE, ngày giao, kiểm tra nguyên liệu, contractSnapshot và safe output. Việc chuyển sang Zod không được đổi accepted input hoặc response hiện tại.

Permission giữ supply_request.create; school lấy từ principal, supplierId chỉ là đối tác lựa chọn hợp lệ. Khi school PAUSED, create mới hoặc gửi DRAFT cũ trả 409, không ghi order/item/snapshot. Không từ chối chỉ vì supplier tạm dừng nhận: tạm dừng NCC được kiểm tra ở bước accept. Gọi send lại khi đã SENT đúng contract là no-op, không phải gửi công việc mới; có thể trả kết quả cũ sau authorization/ownership, không thay dữ liệu.

## 5. Nhận đơn tối thiểu mới

`POST /api/supply-requests/:id/accept`, body `{}`.

Actor SUPPLIER có supply_request.accept hiệu lực; scope supplierId lấy từ actor và phải khớp order. SYSTEM hoặc SCHOOL không có bypass dù được gán permission. Không giới hạn admin nếu staff được cấp cùng permission theo catalog hiện có.

- SENT → ACCEPTED khi Supplier.intakeState=ACTIVE và admin/tài khoản hai bên chưa DEACTIVATED. Ghi acceptedByUserId=actor.id, acceptedAt=server time trong transaction.
- Supplier tạm dừng: 409 cho đơn SENT, kể cả tạo/gửi trước lúc dừng.
- Đơn đã ACCEPTED/IN_PROGRESS: trả trạng thái hiện tại, người/thời điểm nhận đã lưu; không thay người nhận hoặc gọi guard nhận mới để chặn công việc cũ. Vẫn kiểm tra quyền, ownership và account hiện hành.
- DRAFT/COMPLETED/CANCELLED: 409, không thực hiện chuyển trạng thái khác.

200 data `{ id, status, acceptedByUserId, acceptedAt }`. Không trả giá, hợp đồng hay record Prisma. Không mở endpoint chuyển IN_PROGRESS, hoàn tất hoặc giao nhận trong feature này.

## 6. Cán bộ tiếp nhận yêu cầu kiểm tra tối thiểu mới

`POST /api/food-safety-reports/:id/receive`, body `{}`.

Actor COMMUNE_FOOD_SAFETY_OFFICER, AUTHORITY, có food_safety_report.receive hiệu lực. Đây là quyền mới chỉ cho action receive; thêm catalog và grant mặc định cho cán bộ, không tự bootstrap DB. Scope nghiệp vụ theo recipientUserId=actor.id và liên kết xã khớp; bảng đơn vị chỉ là mapping kỹ thuật, không là mô hình admin/member.

- Nếu chưa có receivedAt, người nhận phải ACTIVE, intakeState ACTIVE, incident chưa CLOSED; đặt receivedAt bằng thời gian server.
- Nếu đã có receivedAt, trả lại receipt cũ sau authorization/ownership; đang tạm dừng vẫn được đọc lại kết quả này.
- Chưa nhận và PAUSED: 409. Không tự chuyển incident INVESTIGATING hoặc đóng yêu cầu. Không thay NotificationStatus/forwardedAt.
- External report, recipient không xác định hoặc report thuộc cán bộ khác: 404 cho actor không có scope; dữ liệu sai mapping của chính actor: 409.

200 data `{ id, incidentId, recipientUserId, receivedAt }`.

## 7. Integration contract nội bộ bắt buộc

Service guard nhận trusted actor, operation enum và resource ID đã được kiểm tra; không nhận Prisma where từ controller hoặc Request DTO trực tiếp trong repository. Mỗi lời gọi dùng TransactionClient do service nghiệp vụ sở hữu.

Operations: SCHOOL_CREATE_ORDER, SCHOOL_SEND_ORDER, SUPPLIER_ACCEPT_ORDER, OFFICER_RECEIVE_REQUEST, START_ORDER_PROCESSING, CONTINUE_ACCEPTED_WORK. Chi tiết [data-model.md](../data-model.md).

Writer tương lai cho chuyển IN_PROGRESS, forward report, tạo/chuyển membership phải consume guard và cùng khóa parent. Chuyển IN_PROGRESS được phép trong lúc intake PAUSED nếu đơn đã nhận, nhưng không được thực hiện khi admin/tài khoản liên quan đã DEACTIVATED. Không mở endpoint giả phục vụ test; integration harness gọi adapter tin cậy trong transaction để thử race của những writer chưa có API.

`START_ORDER_PROCESSING` và `CONTINUE_ACCEPTED_WORK` yêu cầu permission do service gọi xác định ở phía server; thiếu permission thì từ chối, không lấy tên permission từ request. Guard membership kiểm tra quyền của actor, khóa cả tổ chức cũ và mới, rồi đọc lại membership trước khi cho phép writer tiếp tục. Guard forward khóa trường, cán bộ và sự cố, xác nhận cán bộ ACTIVE và đang tiếp nhận; guard điều chuyển cán bộ từ chối nếu còn yêu cầu chưa CLOSED. Các guard này phải chạy cùng transaction với write tương ứng và không tạo thêm endpoint.

## 8. Tương thích xác thực và quyền

Sau deactivation, login/refresh/me/business request tiếp theo bị từ chối theo kiểm tra DB hiện có. Không đổi JWT, cookie, quyền, scope đọc, hoặc chặn đăng nhập do intakeState. Logout vẫn theo hợp đồng phiên hiện hành. Scope list cũ không thay đổi ngoài bổ sung mapping người nhận ổn định nếu cần, không mở dữ liệu cán bộ xã khác.
