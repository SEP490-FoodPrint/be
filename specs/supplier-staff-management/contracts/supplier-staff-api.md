# HTTP Contract: Supplier Staff Management

**Updated**: 2026-11-17, đồng bộ email-only login cho mọi vai trò.

Base path: `/api/supplier-staff`. Contract đã triển khai theo [spec](../spec.md); kết quả kiểm chứng local tại [quickstart](../quickstart.md). Dùng phiên đăng nhập, cookie/CSRF hoặc Bearer session hợp lệ theo `docs/AUTH_SESSIONS.md`; không tạo cơ chế auth riêng.

## Authorization chung

Tất cả bảy endpoint yêu cầu actor ACTIVE, role INGREDIENT_SUPPLIER_ADMIN, org SUPPLIER, supplier membership hợp lệ và permission hiệu lực supplier_staff.manage. SYSTEM và staff đều không được phép chỉ nhờ có permission. Scope lấy từ principal, không nhận supplierId/schoolId/orgType/role từ client.

Target phải là INGREDIENT_SUPPLIER_STAFF, Role.type SUPPLIER, thuộc supplier của actor. UUID hợp lệ nhưng không tồn tại, target ở tổ chức khác hoặc target là admin đều trả cùng 404 `Không tìm thấy tài khoản nhân viên`. UUID sai trả 400. List/detail không yêu cầu target ACTIVE; permission endpoints có yêu cầu này.

Không chặn quản lí nhân viên chỉ vì supplier tạm dừng intake; không thay intakeState, không vượt cascade DEACTIVATED.

## Endpoint matrix

| Method | Path dưới base                            | Thành công | Body / query                                        |
| ------ | ----------------------------------------- | ---------- | --------------------------------------------------- |
| GET    | /                                         | 200        | Query page/limit                                    |
| GET    | /:userId                                  | 200        | Không body/query                                    |
| POST   | /                                         | 201        | username, fullName, email, password; phone tùy chọn |
| PATCH  | /:userId/status                           | 200        | status: ACTIVE hoặc LOCKED                          |
| GET    | /:userId/permissions                      | 200        | Không body/query                                    |
| PUT    | /:userId/permission-denials/:permissionId | 200        | Không body hoặc object rỗng; tắt quyền              |
| DELETE | /:userId/permission-denials/:permissionId | 200        | Không body hoặc object rỗng; bật lại quyền          |

Mọi query/params/body được kiểm tra strict; body có trường lạ, query không được hỗ trợ, params UUID sai đều trả 400. Không có thao tác sửa hồ sơ, xóa tài khoản, đổi role hay cấp quyền mới.

## Request rules

### Danh sách

`GET /api/supplier-staff?page=1&limit=20`

Mặc định 1/20; limit tối đa 100; số nguyên dương, offset tối đa 2147483647. Chỉ nhận page/limit, không search/status/role/supplierId. Sắp xếp createdAt giảm dần rồi id tăng dần. Query tối đa limit + 1 bản ghi; danh sách rỗng hoặc vượt trang vẫn 200 với items rỗng, hasNext=false. Không có total.

### Tạo tài khoản

Body gồm đúng các trường sau:

| Field    | Bắt buộc | Validation                                                                                             |
| -------- | -------- | ------------------------------------------------------------------------------------------------------ |
| username | Có       | Trim, 3–120 ký tự; chữ Latin/số đầu tiên, sau đó chữ Latin/số/underscore/chấm/gạch ngang               |
| fullName | Có       | Trim, 1–255 ký tự, không rỗng                                                                          |
| email    | Có       | Trim/lowercase, email hợp lệ, tối đa 254 ký tự                                                         |
| password | Có       | Không trim; ít nhất 8 ký tự Unicode và tối đa 72 byte UTF-8; có chữ thường/hoa/số/dấu câu hoặc ký hiệu |
| phone    | Không    | Bỏ qua/null thành null; chuỗi trim, 1–30 ký tự; không nhận chuỗi rỗng                                  |

Không nhận status, roleId, roleCode, supplierId hoặc trường tổ chức khác. User mới luôn ACTIVE và INGREDIENT_SUPPLIER_STAFF của supplier hiện tại; không tạo registration, không đánh dấu xác minh email thay người dùng. Mật khẩu không phản hồi và không có mặc định dùng chung. Thành công trả detail 201; tất cả vai trò, gồm staff và admin nhà cung cấp, chỉ đăng nhập bằng email và mật khẩu, gửi email trong identifier của POST /api/auth/login theo [login contract](auth-login.md). Không dùng username để tra cứu đăng nhập, không thêm supplier code/link/selector.

Username unique trong cùng supplier theo cách so sánh case-sensitive hiện tại, kể cả so với admin cùng supplier và tài khoản không ACTIVE. Staff của hai supplier khác nhau được cùng username nếu email khác nhau chưa được dùng; cả hai create có thể cùng thành công, kể cả concurrent. Email vẫn unique không phân biệt chữ hoa/thường trên toàn hệ thống, mọi role/org/status. Trùng username trong supplier hoặc email ở bất kỳ đâu trả cùng 409 `Tên đăng nhập hoặc email đã được sử dụng`, không tiết lộ chủ sở hữu/supplier. Race cùng supplier + username hoặc cùng email chỉ tối đa một thành công. Username được dùng ngoài supplier hiện tại không phải lý do từ chối tạo staff.

### Khóa / mở khóa

```json
{ "status": "LOCKED" }
```

Mở khóa dùng ACTIVE. ACTIVE → LOCKED, LOCKED → ACTIVE; đặt lại cùng trạng thái là 200 không ghi/no-op, giữ updatedAt. Target UNVERIFIED/INACTIVE/DEACTIVATED trả 409 `Trạng thái tài khoản không hỗ trợ khóa hoặc mở khóa`. Status khác hai giá trị cho phép trả 400.

Khóa có hiệu lực ở lần login/refresh/yêu cầu nghiệp vụ tiếp theo. Không xóa credential, membership, lịch sử hoặc denials. Mở khóa bảo đảm login mới được phép theo quyền hiện tại; không cam kết khôi phục hoặc thu hồi tất cả phiên cũ.

### Quyền truy cập

GET/PUT/DELETE permissions đều kiểm target trong scope trước khi kiểm ACTIVE. Target thuộc phạm vi nhưng không ACTIVE trả 403 `Chỉ quản lý quyền của tài khoản đang hoạt động`. Không dùng mở quyền để mở khóa hoặc kích hoạt tài khoản.

GET trả mọi permission còn thuộc grants role, kể cả permission isActive=false; enabled chỉ true khi permission active và không có denial của user trong supplier hiện tại. Sắp xếp code tăng dần; role không có grants trả permissions rỗng.

PUT tạo một denial cho user/permission/supplier hiện tại nếu chưa có. DELETE xóa đúng denial đó. Permission không tồn tại, không active hoặc không thuộc role trả 400 `Quyền phải đang hoạt động và thuộc vai trò nhân viên`. Không được dùng endpoint này thêm RolePermission.

PUT/DELETE lặp cùng mục tiêu an toàn, đều trả permission detail sau xử lí. Denial bị tắt riêng tồn tại qua khóa/mở khóa và việc gỡ/cấp lại role grant. Không thay quyền nhân viên khác. Quyền thay đổi có hiệu lực ở request nghiệp vụ tiếp theo của target kể cả dùng phiên cũ.

## Success DTOs

Giữ envelope `sendSuccess`: `{ success: true, statusCode, message, data }`.

| DTO              | data                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| StaffList        | `{ items: StaffListItem[], pagination: { page, limit, hasNext } }`     |
| StaffListItem    | `{ id, username, fullName, email, phone, roleCode, roleName, status }` |
| StaffDetail      | StaffListItem + `{ supplierId, createdAt, updatedAt }`                 |
| StaffPermissions | `{ userId, roleId, permissions: PermissionItem[] }`                    |
| PermissionItem   | `{ id, code, name, module, action, description, isActive, enabled }`   |

id/supplierId/userId/roleId/permission id là UUID string. phone/description có thể null; status là AccountStatus hiện có, roleCode luôn INGREDIENT_SUPPLIER_STAFF. createdAt/updatedAt là ISO 8601 UTC. Permission module/action/name/code là string, isActive/enabled boolean. Không xuất passwordHash, password, token hoặc raw denial rows.

GET list dùng StaffList; GET detail, POST create và PATCH status dùng StaffDetail. GET/PUT/DELETE quyền đều dùng StaffPermissions, giữ semantics envelope của hệ thống.

Thông báo thành công lần lượt: `Lấy danh sách nhân viên thành công`, `Lấy thông tin nhân viên thành công`, `Tạo tài khoản nhân viên thành công`, `Cập nhật trạng thái tài khoản thành công`, `Lấy quyền nhân viên thành công`, `Tắt quyền nhân viên thành công`, `Bật lại quyền nhân viên thành công`.

## Errors

Giữ envelope `sendError`: `{ success: false, statusCode, message, error? }`. Đây là route /api, không tự thêm trường code của /api/v1. Lỗi validation trả error dạng danh sách `{ field, message }`, gộp các lỗi phát hiện, không trả raw values.

| Status | Trường hợp                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| 400    | DTO/query/params sai, trường lạ; permission không active/không thuộc role/không tồn tại                    |
| 401    | Thiếu/sai/hết hạn phiên theo auth contract hiện hành                                                       |
| 403    | Actor thiếu role/permission/membership hoặc không ACTIVE; target permission không ACTIVE                   |
| 404    | Target không tồn tại hoặc không thuộc phạm vi staff; thông báo đồng nhất                                   |
| 409    | Username trùng trong supplier hoặc email trùng toàn hệ thống; target status không hỗ trợ chuyển trạng thái |
| 429    | Rate limit hiện có                                                                                         |
| 503    | DB/Redis không sẵn sàng; hết retry transaction; staff role cấu hình không tồn tại hoặc sai type            |

Sai CSRF theo auth contract hiện hành; không bỏ qua middleware của app. Trường hợp nhiều điều kiện sai ưu tiên xác thực → quyền actor → phạm vi target → trạng thái/business rule; validation đầu vào chạy trước khi service xử lí business. Không lộ lý do target ngoài phạm vi hoặc lỗi SQL.

## Tính nguyên tử và tương thích

Write khóa Supplier → User tăng dần → Role tăng dần, kiểm lại actor/target trong cùng Serializable transaction; role/membership thay đổi không làm scope tự chuyển. Khi actor mất quyền hoặc tổ chức bị cascade vô hiệu hóa, write bị từ chối/retry theo trạng thái hiện tại. Không cho trạng thái cuối còn staff ACTIVE sau cascade toàn tổ chức.

Các route generic users/permissions và CRUD trường không đổi endpoint/body/envelope, không tự redirect sang route mới. Duplicate precheck username của luồng tạo non-staff phải thống nhất namespace non-staff như [data model](../data-model.md), không tiếp tục chặn chỉ vì staff ở supplier khác có cùng username. Signup và các non-staff vẫn không được trùng username với nhau. Client tính năng này dùng đủ bảy route supplier-staff để giữ ranh giới nhân viên.

Yêu cầu triển khai: migration scoped username và auth email-only toàn hệ thống phải sẵn sàng trước khi dùng create với username trùng cross-supplier. Email A trùng username B không phải duplicate email và không tạo lỗi nhiều tài khoản khi đăng nhập; chỉ chủ email được xét, theo SC-007. Migration đã kiểm chứng trên disposable local theo quickstart; chưa áp lên database thành viên hoặc Azure.
