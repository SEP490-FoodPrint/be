# Data Model: quản lý quyền và bộ quyền vai trò

Thiết kế dùng schema hiện tại trong `prisma/schema.prisma`; không sửa schema, migration hoặc seed. Mô hình đã được dùng khi triển khai; chỉ tạo fixture trên database disposable để kiểm thử, không thay đổi dữ liệu vận hành.

## Permission — foodprint.permissions

| Trường      | Kiểu hiện hữu          | Quy tắc                                                           |
| ----------- | ---------------------- | ----------------------------------------------------------------- |
| id          | UUID, khóa chính       | Sinh bởi hệ thống; bất biến                                       |
| code        | varchar(100), unique   | Bắt buộc khi tạo, trim, regex như contract; bất biến khi sửa      |
| name        | varchar(150)           | Trim; 1–150; được sửa                                             |
| module      | varchar(80)            | Trim; định dạng phần mã; bất biến sau tạo                         |
| action      | varchar(50)            | Trim; định dạng phần mã; bất biến sau tạo                         |
| description | text nullable          | Bỏ qua/null khi tạo → null; chuỗi trim 1–2.000; PATCH null để xóa |
| isActive    | boolean, mặc định true | Chỉ thay qua thao tác trạng thái toàn cục                         |
| createdAt   | timestamptz            | Không đổi; không đưa vào Permission DTO hiện tại                  |

Không có updatedAt/version trong model hiện tại; không thêm trường để phục vụ PATCH. PATCH chỉ cập nhật cột có trong request, không ghi lại toàn bộ record từ snapshot cũ.

## Role — foodprint.roles

id UUID; code varchar(60), unique; name varchar(120); type RoleType; description nullable; createdAt. Giữ nguyên mã/nhãn/nhóm tổ chức hiện hữu, gồm SYSTEM, SCHOOL, SUPPLIER, AUTHORITY.

`editable` là thuộc tính suy ra cho DTO, không lưu DB: false khi code = SYSTEM_ADMIN, true ở các role còn lại. Trường này nói về bộ quyền gán, không giới hạn việc sửa metadata/isActive của Permission được gán cho role.

## RolePermission — foodprint.role_permissions

- Khóa chính ghép (roleId, permissionId); FK đến Role và Permission; assignedAt.
- Cấp quyền mới tạo một quan hệ; thu hồi xóa đúng quan hệ. Các quan hệ không đổi giữ assignedAt.
- Tạm ngừng/kích hoạt Permission không thêm, xóa hoặc sửa quan hệ.
- C là tập permissionId hiện tại sau khóa role; R là tập request:
  - R−C: mọi quyền phải tồn tại và active.
  - C∩R: giữ nguyên, kể cả inactive.
  - C−R: thu hồi, kể cả inactive.
- R rỗng hợp lệ cho role có thể sửa; tối đa 1.000 UUID không trùng sau lowercase.
- Role SYSTEM_ADMIN: mọi yêu cầu thay đổi bộ quyền trả 403, kể cả cùng tập hoặc tập rỗng.
- Gọi touchRole khi thay đổi grants để tạo MVCC version theo protocol hiện hữu; đây là UPDATE name = name trong repository, không thêm updatedAt hoặc đổi tên role.

## UserPermissionDenial — cấu hình hạn chế hiện hành

Giữ các FK và phạm vi userId/permissionId/schoolId/supplierId/communeFoodSafetyUnitId hiện tại, không thêm history. Thay grants hoặc Permission.isActive không được sửa/xóa denial.

Refactor các thao tác xem/bật/tắt quyền người dùng trong cùng module phải giữ scope tổ chức tin cậy, điều kiện tài khoản mục tiêu ACTIVE, và permission vừa active vừa thuộc role khi bật/tắt denial như hợp đồng hiện hành. System Admin chỉ xem qua user.manage; không biến API denial của tổ chức thành API sửa grant cá nhân toàn cục.

## Trusted scope và Request DTO

Scope nội bộ không phải dữ liệu DB hoặc đầu vào HTTP:

- CatalogRoleScope/CatalogPermissionScope: `kind: "SYSTEM"`, chỉ tạo sau kiểm tra SYSTEM_ADMIN + SYSTEM + guard tương ứng tại resource-access.
- Scope xem tài khoản hoặc ghi denial: SYSTEM chỉ cho đọc phù hợp user.manage; SCHOOL/SUPPLIER dùng membership hiện tại của principal và quyền quản trị tổ chức hiện hữu.
- Repository nhận scope và tự dựng WHERE; client không gửi organizationId để chọn phạm vi.

Request DTO nằm riêng `permission.request.dto.ts`, suy ra từ schema validation bằng type-only imports. Nhóm query: PermissionQuery (page/limit/search theo tên) và RoleQuery (chỉ page/limit) và InactivePermissionQuery (nhận page, chuẩn hóa limit=5 cố định); các nhóm còn lại: RoleParams, PermissionParams, UserParams, UserPermissionParams, CreatePermission, UpdatePermission, PermissionState, ReplaceRolePermissions, EmptyBody. Service nhận principal và các DTO cần thiết; controller không import DTO.

## Response DTO và ánh xạ

- Permission: `id, code, name, module, action, description, isActive`.
- RoleSummary: `id, code, name, type, editable`.
- RolePermissions: các trường RoleSummary và `permissions: Permission[]`, chỉ gồm quyền đã gán (active lẫn inactive), thứ tự code ASC/id ASC.
- ReplaceRolePermissionsResult: `roleId, permissionIds`, giữ shape hiện tại.
- List: `items` và `pagination: {page, limit, hasNext}`.
- UserPermissions: `userId, roleId, permissions`; mỗi mục giữ Permission cùng `enabled` theo quyền hiệu lực hiện tại.

Mọi DTO được service dựng bằng allowlist, không spread bản ghi persistence. Không thêm Date/Decimal/BigInt vào output; output cũ nào có giá trị này phải serialize tường minh, không dựa JSON.stringify ngầm.

## Trạng thái và bất biến

| Thao tác                | Trước                | Sau                           | Không thay đổi                          |
| ----------------------- | -------------------- | ----------------------------- | --------------------------------------- |
| Tạo                     | Chưa có code         | Permission active, chưa gán   | Mọi grants/denials hiện tại             |
| Sửa tên/mô tả           | Active hoặc inactive | Cùng trạng thái, metadata mới | id/code/module/action và grants/denials |
| Tạm ngừng               | isActive = true      | isActive = false              | Mọi grants/denials                      |
| Kích hoạt               | isActive = false     | isActive = true               | Mọi grants/denials                      |
| Gửi lại cùng trạng thái | Bất kỳ               | Giữ trạng thái, trả 200       | Mọi grants/denials                      |
| Sửa bộ quyền            | C                    | R                             | Denials và grants của role khác         |

Quyền hiệu lực = permission active trong bộ quyền role trừ denial thuộc tổ chức hiện tại. Kích hoạt không cấp lại grant đã bị thu hồi. Tự tắt quyền quản trị không có bypass mở lại; ngoài phạm vi phục hồi vận hành.
