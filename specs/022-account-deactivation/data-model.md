# Data model: Vô hiệu hóa và tạm dừng tiếp nhận

Thiết kế cho [spec.md](spec.md); chưa sửa `prisma/schema.prisma`, SQL hay database. Tên mới dưới đây là quyết định thiết kế, không thay tên cột/model đã được phê duyệt.

## 1. Trạng thái tạm dừng độc lập

Thêm enum Prisma PascalCase `IntakeState`, map SQL `intake_state` trong schema `foodprint`:

| Giá trị                           | Ý nghĩa                                                |
| --------------------------------- | ------------------------------------------------------ |
| ACTIVE                            | Không có giới hạn tạm dừng tiếp nhận của tính năng này |
| PAUSED                            | Trường dừng tạo/gửi đơn hoặc cán bộ dừng nhận yêu cầu  |
| PAUSED_FOR_FOOD_SAFETY_INSPECTION | Nhà cung cấp dừng nhận đơn để phục vụ kiểm tra ngộ độc |

| Model    | Trường mới                 | Mặc định | Ràng buộc SQL                                           |
| -------- | -------------------------- | -------- | ------------------------------------------------------- |
| School   | intakeState / intake_state | ACTIVE   | Chỉ ACTIVE hoặc PAUSED                                  |
| Supplier | intakeState / intake_state | ACTIVE   | Chỉ ACTIVE hoặc PAUSED_FOR_FOOD_SAFETY_INSPECTION       |
| User     | intakeState / intake_state | ACTIVE   | Cán bộ chỉ ACTIVE/PAUSED; mọi role khác bắt buộc ACTIVE |

Không sửa `EntityStatus`, `AccountStatus`, trạng thái quan hệ trường–nhà cung cấp hoặc permission denials. Tạm dừng admin trường/nhà cung cấp ghi vào parent tổ chức; không cập nhật intakeState mọi user. Tạm dừng cán bộ ghi đúng User được chỉ định. Giữ `@updatedAt` trên cột thời gian hiện có; gọi lặp cùng giá trị không update để không đổi timestamp giả.

Chuyển trạng thái do System Admin có `user.manage` chủ động thực hiện:

- School: ACTIVE ↔ PAUSED.
- Supplier: ACTIVE ↔ PAUSED_FOR_FOOD_SAFETY_INSPECTION.
- User cán bộ: ACTIVE ↔ PAUSED.
- Không tự đổi khi incident mở/đóng; gỡ tạm dừng không đổi AccountStatus hoặc tự gửi/nhận công việc.

## 2. Vô hiệu hóa tài khoản

Dùng `User.status=DEACTIVATED` hiện có. Đích phải thuộc một trong ba role đã chốt và có membership đúng loại. Đích chưa được gắn tổ chức/xã bị từ chối; không dùng tính năng để xử lý hồ sơ UNVERIFIED chưa được duyệt.

| Đích                        | Điều kiện chặn                                                       | Phạm vi ghi                   |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------- |
| SCHOOL_ADMINISTRATION       | EXISTS SupplyRequest.schoolId = trường đích AND status = IN_PROGRESS | Mọi User.schoolId = trường đó |
| INGREDIENT_SUPPLIER_ADMIN   | EXISTS SupplyRequest.supplierId = NCC đích AND status = IN_PROGRESS  | Mọi User.supplierId = NCC đó  |
| COMMUNE_FOOD_SAFETY_OFFICER | Có forwarding thuộc cán bộ mà FoodSafetyIncident.status khác CLOSED  | Chỉ User.id = cán bộ đích     |

Không kiểm tra chặn riêng trạng thái Delivery; DRAFT/SENT/ACCEPTED/COMPLETED/CANCELLED không chặn admin. Toàn bộ tài khoản cùng tổ chức chuyển DEACTIVATED kể cả INACTIVE/LOCKED hoặc trạng thái khác. Giữ record, membership, grants, denials và unique admin hiện có. Đã DEACTIVATED và mọi tài khoản liên quan cũng DEACTIVATED thì trả thành công không ghi; còn thành viên chưa DEACTIVATED là xung đột dữ liệu, không báo thành công giả.

## 3. Một cán bộ mỗi xã

Giữ `CommuneFoodSafetyUnit` là định danh kỹ thuật của xã và các FK đã có. Không cung cấp API thành viên hay nhóm tổ chức cho cán bộ.

Bổ sung partial unique tên dự kiến `uq_users_commune_officer` trên `users(commune_food_safety_unit_id)` với predicate `role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'`. Predicate không giới hạn AccountStatus: tính cả inactive/deactivated. CHECK cũ chỉ giới hạn tối đa một tổ chức; migration thêm CHECK yêu cầu cán bộ ACTIVE có xã và không thuộc trường/NCC, đồng thời cho phép dữ liệu inactive chưa gắn xã để không tự thay đổi lịch sử. Preflight cũng phát hiện role cán bộ có type khác AUTHORITY. Không biến relation Prisma thành một-một giả vì uniqueness có điều kiện; giữ collection `users` phục vụ schema kỹ thuật.

Không tạo tài khoản, không xóa/gộp tài khoản để thỏa index. Bất kỳ provisioning hoặc đổi membership tương lai phải cùng guard; không chuyển xã/đổi role cán bộ đang có yêu cầu chưa CLOSED hoặc làm mất tính duy nhất.

## 4. FoodSafetyReportForwarding: định danh và nhận nghiệp vụ

| Trường                              | Kiểu                      | Quy tắc                                                            |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| recipientUserId / recipient_user_id | UUID nullable, FK User.id | Cán bộ cụ thể nhận yêu cầu nội bộ; dữ liệu external cũ có thể null |
| receivedAt / received_at            | timestamptz(6) nullable   | Chỉ action tiếp nhận thành công được đặt bằng thời gian server     |

Giữ nguyên recipientCommuneFoodSafetyUnitId, các trường external, NotificationStatus, forwardedAt và createdAt. Thêm relation User có tên riêng để không trùng User là người chuyển tiếp; FK onDelete Restrict. `receivedAt IS NOT NULL` đòi hỏi recipientUserId non-null; recipientUserId non-null đòi hỏi recipientCommuneFoodSafetyUnitId non-null. Service kiểm tra role cán bộ và liên kết xã khớp trong transaction. Không nhận recipientUserId hoặc thời điểm nhận từ body action receive.

Thêm index `(recipient_user_id, incident_id)` phục vụ EXISTS blocker. Dùng index đơn `(school_id,status)` và `(supplier_id,status)` đã có của SupplyRequest; không thêm index trùng. Khi truy vấn blocker, không lọc forwarding theo NotificationStatus hoặc receivedAt: yêu cầu được gửi tới cán bộ nhưng chưa nhận vẫn ngăn vô hiệu hóa nếu incident chưa CLOSED. Legacy row có recipientUserId=null và đúng xã cán bộ vẫn được xét để không bỏ sót.

Phân biệt rõ hai trục:

- NotificationStatus PENDING/SENT/FAILED: kết quả gửi thông báo, giữ nghiệp vụ hiện hành.
- receivedAt null/non-null: chưa có bằng chứng tiếp nhận / đã tiếp nhận.
- FoodSafetyIncident.OPEN/INVESTIGATING/RESOLVED/CLOSED: tiến độ sự cố. Chỉ CLOSED bỏ chặn khóa; action receive không tự đổi tiến độ.

Action receive lặp trên cùng report đã nhận trả lại timestamp cũ. Nếu nhận nhầm tài khoản/xã hoặc người nhận không xác định, từ chối. Nhận report liên quan incident CLOSED bị từ chối nếu receivedAt còn null; bản ghi đã nhận vẫn có thể trả kết quả lặp mà không sửa lịch sử. Gửi thông báo lại không tự điền receipt. Cùng incident có nhiều forwarding thì từng report có receipt riêng, blocker dùng EXISTS không cộng trùng.

## 5. Quy tắc lệnh ghi

| Lệnh                    | Kiểm tra tạm dừng           | Điều kiện/lưu ý                                                                            |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| SCHOOL_CREATE_ORDER     | School.intakeState ACTIVE   | Giữ body, kiểm tra ingredient/contract và scope hiện có                                    |
| SCHOOL_SEND_ORDER       | School.intakeState ACTIVE   | Không gửi DRAFT cũ trong lúc tạm dừng                                                      |
| SUPPLIER_ACCEPT_ORDER   | Supplier.intakeState ACTIVE | Chỉ SENT → ACCEPTED, ghi acceptedByUserId/acceptedAt từ actor/server                       |
| OFFICER_RECEIVE_REQUEST | User.intakeState ACTIVE     | Đúng recipientUserId, tài khoản ACTIVE; điền receivedAt một lần                            |
| START_ORDER_PROCESSING  | Không chặn bởi intakeState  | Việc đã ACCEPTED được tiếp tục; phải kiểm tra admin hai bên chưa DEACTIVATED và scope đúng |
| CONTINUE_ACCEPTED_WORK  | Không chặn bởi intakeState  | Giữ permission và vòng đời hiện hành; không dùng để nhận mới                               |

Chỉ trạng thái tạm dừng của actor-side tương ứng quyết định chặn: trường tạm dừng không cấm NCC nhận đơn đã SENT; NCC tạm dừng không cấm trường tạo/gửi đơn. Không tự mở rộng thành đình chỉ mọi tương tác của cả hai bên. Mọi thao tác mới vẫn kiểm tra account/admin liên quan chưa DEACTIVATED; không cho đối tác đưa đơn ACCEPTED của tổ chức đã khóa sang IN_PROGRESS.

## 6. Transaction và integrity

Service gọi `authorizationTransaction` và mọi repository dùng cùng TransactionClient. Khóa parent theo thứ tự School → Supplier → User → Role actor, ID tăng dần; khóa order/report sau các khóa này. Đọc đích ban đầu để xác định scope không phải bằng chứng cấp quyền: phải đọc lại dưới khóa. Tái nạp actor/quyền và kiểm tra membership trong transaction. Recheck condition, updateMany và map Response DTO trước trả kết quả; không có Redis write bắt buộc sau commit.

Các lệnh thêm/chuyển tài khoản phải lock parent và từ chối tạo tài khoản ACTIVE dưới admin DEACTIVATED. Việc chuyển đơn sang IN_PROGRESS và forward/receive yêu cầu cùng giao thức. Kiểm thử phantom thật bắt buộc; không xem mock như bằng chứng đầy đủ.

## 7. Migration được thiết kế, chưa được chạy

Tạo migration mới, không sửa migration/baseline đã áp dụng:

1. Preflight phát hiện nhiều officer cùng xã kể cả inactive; mapping người nhận nội bộ sai/xã không có officer cho công việc chưa CLOSED; dừng với thông báo xử lý vận hành, không ghi sửa tự động.
2. Thêm enum/trường với mặc định ACTIVE để trạng thái tiếp nhận hiện có không tự bị dừng; thêm nullable recipient/receipt.
3. Backfill người phụ trách hiện tại chỉ khi ánh xạ duy nhất theo xã, không khẳng định người nhận lịch sử. External vẫn null; không suy diễn receivedAt từ notification/forwardedAt.
4. Thêm partial unique, CHECK và FK/index mới. Nêu trong SCHEMA_BASELINE.md migration mới và trạng thái triển khai thực tế, giữ manifest baseline bất biến.
5. Test fresh migration, upgrade fixture sạch, duplicate/orphan rejection và bảo toàn dữ liệu. Deploy chỉ sau review và quyền vận hành rõ ràng hoặc dev CD được duyệt.

Receipt lịch sử không có bằng chứng giữ null; không coi INVESTIGATING là đã nhận. Dữ liệu vận hành cần đánh dấu đã nhận phải được operator xác minh và ủy quyền riêng trước rollout. Không tạo tài khoản/mẫu nghiệp vụ hoặc seed ngầm.

## Bổ sung sau kiểm thử PostgreSQL: hiệu lực thu hồi quyền

Regression thật cho thấy Serializable snapshot có thể giữ grants/denials cũ sau khi writer quản trị quyền đã commit, dù service đọc lại bằng cùng transaction. Các action của feature lấy khóa theo thứ tự School → Supplier → User → Role của actor → resource. Writer thay denial chỉ khi dữ liệu thay đổi sẽ cập nhật User.updatedAt trong cùng transaction; writer thay grants tạo phiên bản MVCC mới cho hàng Role bằng no-op update, bảo toàn mọi giá trị nghiệp vụ vì Role hiện không có updatedAt. Khi writer này đã commit trước bước khóa actor/role của action, PostgreSQL phát hiện snapshot không còn hợp lệ và shared retry tải quyền mới. Không dùng client ngoài transaction, không đổi isolation/timeout hoặc thêm schema field. Permission writer giữ giao thức User cho denial và Role cho grants; query mới nằm trong repository.

Role actor dùng FOR SHARE, cho phép các thao tác nghiệp vụ cùng role chạy đồng thời và xung đột với writer đổi grants. Các row tổ chức/người dùng/resource tiếp tục khóa theo giao thức tương ứng.
