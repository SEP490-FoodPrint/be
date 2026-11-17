# HTTP Contract: role permission management

**Base**: /api. Dùng router permission hiện hữu; không thêm /v1. Các endpoint dưới đây đã được triển khai và kiểm chứng backend; xem kết quả trong [quickstart.md](../quickstart.md).

## Xác thực và phạm vi

Middleware xác thực lấy sub/sid từ phiên hợp lệ rồi nạp tài khoản ACTIVE, role, membership và quyền hiệu lực hiện tại. Mọi endpoint catalog/role dưới đây yêu cầu SYSTEM_ADMIN thuộc SYSTEM cùng guard chỉ định; role/organization từ request không phải nguồn phân quyền.

Mọi write cần `X-CSRF-Protection: 1`; Origin nếu gửi phải khớp cấu hình. Cookie HttpOnly dùng credentials/include; bearer phải có phiên hợp lệ theo [AUTH_SESSIONS.md](../../../docs/AUTH_SESSIONS.md). Giữ rate limiter hiện tại. Không cache quyết định phân quyền; response quản trị dùng Cache-Control: private, no-store.

| Method | Path                             | Guard                  | Trạng thái                              |
| ------ | -------------------------------- | ---------------------- | --------------------------------------- |
| GET    | /roles                           | role.view              | Mới                                     |
| GET    | /permissions/inactive            | permission.view        | Mới: chỉ inactive, mỗi trang 5          |
| GET    | /permissions                     | permission.view        | Giữ hợp đồng, thêm scope/repository/DTO |
| POST   | /permissions                     | permission.create      | Giữ hợp đồng                            |
| PATCH  | /permissions/:permissionId       | role_permission.manage | Mới: metadata                           |
| PATCH  | /permissions/:permissionId/state | role_permission.manage | Mới: trạng thái toàn cục                |
| GET    | /roles/:roleId/permissions       | role_permission.manage | Giữ hợp đồng                            |
| PUT    | /roles/:roleId/permissions       | role_permission.manage | Giữ shape; cho giữ grant inactive đã có |

GET /api/auth/roles vẫn hoạt động theo hợp đồng hiện hữu, không chuyển route hoặc đổi response của module auth.

## Envelope và dữ liệu dùng chung

Thành công: `{success:true,statusCode,message,data}`. Status 200 cho GET/PATCH/PUT, 201 cho POST. message tiếng Việt. Không trả persistence record.

Permission DTO:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "code": "menu.view",
  "name": "Xem thực đơn",
  "module": "menu",
  "action": "view",
  "description": null,
  "isActive": true
}
```

UUID ví dụ chỉ mô tả shape, không phải dữ liệu fixture hay định danh có thể dùng trên hệ thống thật. Không đưa createdAt, grant internals hoặc thông tin tài khoản vào Permission DTO.

Quy ước page/limit mặc định dưới đây áp dụng GET /roles và GET /permissions; /permissions/inactive dùng quy tắc riêng cố định 5 mục/trang.

List data: `{items:[...],pagination:{page:1,limit:20,hasNext:false}}`. Query page/limit là chuỗi số nguyên dương, mặc định 1/20, limit tối đa 100; offset tối đa 2.147.483.647. GET /roles chỉ nhận page/limit; GET /permissions nhận thêm search như mô tả bên dưới, không nhận filter/sort/orgId. Trang vượt cuối trả items rỗng. Thứ tự code ASC, id ASC, fetch limit+1; không có total mới.

Path UUID được normalize lowercase, giữ regex UUID hiện hành. Body/query/params dùng strict schemas; lỗi các trường được gom qua parseRequest.

## GET /roles

data.items là `{id,code,name,type,editable}`; type là nhóm tổ chức hiện có. editable=false duy nhất cho SYSTEM_ADMIN. Cả vai trò chỉ đọc và có thể sửa đều xuất hiện; người quản trị duyệt được toàn bộ bằng pagination.

## GET /permissions

data.items là Permission DTO, gồm active và inactive. Trạng thái inactive không khiến quyền biến mất khỏi danh mục quản trị.

Query tùy chọn search: chuỗi tối đa 150 ký tự sau trim; tìm một phần name không phân biệt hoa/thường, giữ nguyên dấu, không tìm code/module/action/description. Bỏ qua, rỗng hoặc toàn khoảng trắng nghĩa là không lọc. %, _ và backslash là ký tự literal. Lọc trước pagination, giữ order code/id và hasNext trên tập đã lọc. Search lặp (mảng), object hoặc quá dài trả 400 tại error.fields.search. GET /roles?search=... vẫn 400.

Ví dụ: GET /api/permissions?search=xem&page=1&limit=20. Guard vẫn là SYSTEM_ADMIN/SYSTEM và permission.view.

## GET /permissions/inactive

Danh sách riêng quyền chưa bật trên toàn hệ thống: isActive=false, gồm cả quyền chưa được gán hoặc được gán cho role; không có nghĩa là quyền chưa gán cho một role cụ thể. Guard SYSTEM_ADMIN/SYSTEM + permission.view như danh mục.

Chỉ nhận query page, số nguyên dương dạng chuỗi, mặc định 1; limit luôn 5 và không nhận limit/search/query lạ. Tái dùng kiểm tra offset (page−1)×5 <= 2.147.483.647. Trả 200 với data {items:Permission[],pagination:{page,limit:5,hasNext}}, tối đa 5 mục, lọc inactive trước phân trang, order code/id. Trang rỗng/vượt cuối trả items=[], hasNext=false. Query sai trả 400 theo error.fields, thiếu quyền 403. Giữ Cache-Control private, no-store.

Ví dụ: GET /api/permissions/inactive?page=2.

## POST /permissions

Strict body:

```json
{
  "code": "menu.export",
  "name": "Xuất thực đơn",
  "module": "menu",
  "action": "export",
  "description": null
}
```

code/name/module/action bắt buộc; description tùy chọn, bỏ qua hoặc null thành null. Tất cả chuỗi trim; name 1–150, code tối đa 100, module 80, action 50, description nếu là chuỗi 1–2.000. code khớp `^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$`; module/action khớp `^[a-z][a-z0-9_]*$`. Không nhận id/isActive/roleIds.

Trả 201 với Permission DTO, isActive=true. Không tự gán grant. Trùng code dù inactive → 409. Tạo một code không tự sinh endpoint hoặc quyền truy cập cho chức năng chưa sử dụng code đó.

## PATCH /permissions/:permissionId

Strict body: name và/hoặc description; cần ít nhất một trường.

```json
{ "name": "Tên quyền mới", "description": null }
```

name nếu có phải trim 1–150; description nếu có là null để xóa hoặc chuỗi trim 1–2.000. Bỏ qua trường giữ nguyên giá trị. Body rỗng, description rỗng/whitespace hoặc code/module/action/isActive/trường lạ → 400. Active và inactive đều sửa được.

Trả 200 Permission DTO sau lưu. Không thay code/module/action/isActive/grants/denials; không cần permission.view nếu người gọi có đúng guard của thao tác này.

## PATCH /permissions/:permissionId/state

Strict body:

```json
{ "isActive": false }
```

Chỉ nhận boolean thật, không coerce "false", 0, null. false tạm ngừng, true kích hoạt; cùng trạng thái trả 200 với Permission DTO hiện tại. Không sửa grants hoặc denials.

Trạng thái áp dụng mọi role, kể cả SYSTEM_ADMIN. Nếu target là role_permission.manage và người gọi đang có guard này, request tự tắt có thể trả 200 sau recheck, các request quản trị sau đó trả 403; không có endpoint bypass hoặc tự bootstrap lại. Tính chỉ đọc của bộ quyền SYSTEM_ADMIN không cấm đổi trạng thái chung.

## GET /roles/:roleId/permissions

Trả data:

```text
{
  id, code, name, type, editable,
  permissions: Permission[]
}
```

Mảng chỉ gồm quyền đã gán, cả inactive; order code ASC/id ASC. Ghép với danh mục /permissions để xác định quyền chưa gán; isActive là trạng thái chung, không phải cờ gán. Không thêm assigned hoặc enabled vào output hiện hữu này.

## PUT /roles/:roleId/permissions

Strict body:

```json
{ "permissionIds": ["11111111-1111-4111-8111-111111111111"] }
```

Tối đa 1.000 UUID distinct sau normalize, không coercion hoặc bỏ qua phần tử sai. permissionIds=[] hợp lệ cho role có thể sửa. Quyền đã gán dù inactive được giữ hoặc thu hồi; quyền được thêm mới phải tồn tại và active. Bất kỳ phần tử sai nào khiến toàn bộ lần lưu bị từ chối; không đổi denials.

Trả data `{roleId,permissionIds}` như hiện tại, permissionIds là danh sách request đã normalize. Target SYSTEM_ADMIN → 403 dù gửi bộ quyền giống hiện tại. Role không tồn tại → 404. Cạnh tranh giữa hai PUT kết thúc bằng một bộ quyền đầy đủ của lần lưu được chấp nhận sau cùng, không có merge từng phần hoặc version token.

## Các API user permission/denial giữ nguyên

| Method | Path                                            | Guard và scope giữ lại                                                               |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET    | /users/:userId/permissions                      | SYSTEM_ADMIN/SYSTEM + user.manage; hoặc admin tổ chức có quyền quản trị cùng tổ chức |
| PUT    | /users/:userId/permission-denials/:permissionId | Chỉ admin trường/NCC đúng tổ chức và quyền quản trị hiện hành                        |
| DELETE | /users/:userId/permission-denials/:permissionId | Như PUT, mở lại bằng xóa denial                                                      |

User detail giữ `{userId,roleId,permissions:[Permission & {enabled:boolean}]}`. Target phải ACTIVE theo hợp đồng hiện tại; ngoài phạm vi hoặc không tồn tại trả 404. Denial write chỉ cho permission active thuộc role target; authority không có chức năng quản trị dù được gán guard. Không mở rộng System Admin thành người ghi denial toàn cục. Các write không nhận thêm trường nghiệp vụ, dùng schema rỗng phù hợp cách gọi hiện hữu. Refactor không đổi semantics.

## Lỗi và điểm chấp nhận ghi

Lỗi chung: `{success:false,statusCode,message,error?}`. Validation: `error:{fields:[{field,message}]}`, ví dụ permissionIds.2. Không tự thêm trường errors hoặc code của /v1 vào các route này.

| Status | Tình huống                                                                                  |
| ------ | ------------------------------------------------------------------------------------------- |
| 400    | Sai body/query/UUID; permissionId không tồn tại trong bộ quyền gửi lên; gán mới inactive    |
| 401    | Không có phiên/xác thực hợp lệ                                                              |
| 403    | Tài khoản không hoạt động, role/org/guard không đủ; sửa grant SYSTEM_ADMIN; lỗi CSRF/origin |
| 404    | Permission hoặc role của thao tác trực tiếp không tồn tại; user không tồn tại/ngoài scope   |
| 409    | Trùng permission.code                                                                       |
| 503    | DB không khả dụng, conflict còn lại sau bounded retry hoặc Redis auth/rate-limit lỗi        |

Các bước ghi dùng cùng Serializable transaction. Recheck actor và target sau khóa theo [research.md](../research.md#r6--khóa-và-retry-cho-mọi-ghi-quản-trị); không dùng principal đầu request làm nguồn duy nhất để cho phép ghi. Thay đổi commit có hiệu lực từ request nghiệp vụ kế tiếp; không hứa hủy thao tác đã chấp nhận trước đó. Mọi trường hợp lỗi lưu không để lại cập nhật một phần.
