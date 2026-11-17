# Data Model: Supplier Staff Management

**Updated**: 2026-11-17, sau quyết định email-only toàn hệ thống. Giữ các entity/field hiện có trong schema foodprint; cần migration mới thay uniqueness username và cập nhật prisma/schema.prisma. Không thêm model/field, seed hoặc backfill; bước plan không thay đổi schema/dữ liệu đang vận hành.

## Entities và quan hệ

| Entity                      | Thuộc tính liên quan                                                                                                            | Quan hệ / giới hạn                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Supplier                    | id, intakeState                                                                                                                 | Sở hữu nhiều User staff; intake tạm dừng không tự khóa user                         |
| User actor                  | id, roleId, roleCode, supplierId, status                                                                                        | ACTIVE, INGREDIENT_SUPPLIER_ADMIN, role type SUPPLIER, supplier membership hợp lệ   |
| User staff                  | id, username, email, passwordHash, fullName, phone, roleId, roleCode, supplierId, status, emailVerifiedAt, createdAt, updatedAt | Một role duy nhất, INGREDIENT_SUPPLIER_STAFF; schoolId/communeFoodSafetyUnitId null |
| Role                        | id, code, type                                                                                                                  | Chọn staff role bằng code hằng và type SUPPLIER; không tạo role mới                 |
| RolePermission / Permission | roleId, permissionId; code, name, module, action, description, isActive                                                         | Grants là trần quyền, do quản trị hệ thống quản lí                                  |
| UserPermissionDenial        | id, userId, permissionId, supplierId, disabledByUserId, disabledAt                                                              | Chỉ một denial mỗi user/permission/supplier; schoolId/communeFoodSafetyUnitId null  |

## Ràng buộc persistence cần giữ

- User username của staff chỉ unique trong supplier, kể cả so với admin cùng supplier và mọi status. Username giữ so sánh case-sensitive như varchar hiện hành; không tự lowercase. Staff khác supplier được trùng username với nhau hoặc non-staff ngoài supplier.
- Username của non-staff vẫn unique với các non-staff trên toàn hệ thống, gồm tài khoản chưa có membership. Đây là ràng buộc dữ liệu tài khoản đã chốt; không phải định danh đăng nhập của bất kỳ vai trò nào.
- User email Citext unique toàn cục, không phân biệt chữ hoa/thường. Tài khoản không ACTIVE vẫn giữ username/email.
- Composite FK roleId/roleCode trỏ đúng Role(id, code). Partial unique uq_users_supplier_admin chỉ áp cho admin, không hạn chế staff.
- User/denial CHECK đảm bảo membership tổ chức; giữ tất cả định danh và predicate đã có. Không mô hình hóa staff bằng Supplier admin thứ hai.
- Denial có uq_user_permission_denials_supplier khi supplierId không null. PUT dùng skipDuplicates thay vì unique selector ghép không được Prisma hỗ trợ cho partial index; xóa dùng filter đầy đủ.
- Prisma @updatedAt quản lí updatedAt khi status thật sự đổi. Same-state no-op không ghi. Denial thay đổi gọi touchUser hiện có để cập nhật MVCC; không tự thêm timestamp/history mới.

## Validation đầu vào

| Trường                | Quy tắc                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| userId / permissionId | UUID hợp lệ theo requestUuidSchema, chuẩn hóa chữ thường                                                                                              |
| page / limit          | Chuỗi số nguyên dương, mặc định 1/20, limit tối đa 100, offset không vượt 2147483647; query lạ bị từ chối                                             |
| username              | Bắt buộc, trim, 3–120 ký tự; ký tự đầu chữ Latin hoặc số, các ký tự sau chỉ chữ Latin/số/underscore/dấu chấm/gạch ngang, theo đăng ký hiện hành       |
| fullName              | Bắt buộc, trim, 1–255 ký tự sau chuẩn hóa theo requiredText hiện hành                                                                                 |
| email                 | Bắt buộc, trim/lowercase, tối đa 254 ký tự, định dạng email hợp lệ                                                                                    |
| password              | Bắt buộc, không trim; ít nhất 8 ký tự Unicode, tối đa 72 byte UTF-8, có chữ thường/hoa, số, ký tự dấu câu hoặc ký hiệu theo password policy hiện hành |
| phone                 | Bỏ qua hoặc null thành null; nếu gửi chuỗi thì trim, 1–30 ký tự, chuỗi rỗng bị từ chối                                                                |
| status body           | Chỉ nhận ACTIVE hoặc LOCKED; trường khác bị từ chối                                                                                                   |

Tất cả object đầu vào dùng strictObject/safeParse; thu lỗi tiếng Việt cùng field paths, không chứa giá trị đầu vào. Quy tắc mật khẩu được biểu diễn thành refinement tương thích Zod, không gọi validator ném lỗi bên trong làm mất các issue khác. Không sửa chính sách đăng ký hiện có trong tính năng này.

## Tạo tài khoản

Service nhận Request DTO đã chuẩn hóa, tạo passwordHash trước transaction. Duplicate check gồm email toàn cục OR username trong trusted supplier, không chỉ các target staff; trùng admin cùng supplier cũng từ chối. Hai supplier tạo cùng username và email khác nhau chưa dùng đều hợp lệ; global email vẫn chặn race giữa supplier. Repository nhận internal create input gồm các field allowlist, hash và trusted scope; roleId được xác minh trong tx. Ghi User ACTIVE, supplierId của scope, roleCode staff, schoolId/communeFoodSafetyUnitId null, emailVerifiedAt null. Không nhận các giá trị này từ client và không tạo RegistrationRequest, RolePermission, denial hay phiên đăng nhập.

## Chuyển trạng thái

| Hiện tại                            | Yêu cầu         | Kết quả                                |
| ----------------------------------- | --------------- | -------------------------------------- |
| ACTIVE                              | LOCKED          | Khóa, cập nhật trạng thái/timestamp    |
| LOCKED                              | ACTIVE          | Mở khóa, cập nhật trạng thái/timestamp |
| ACTIVE                              | ACTIVE          | Thành công không ghi                   |
| LOCKED                              | LOCKED          | Thành công không ghi                   |
| UNVERIFIED / INACTIVE / DEACTIVATED | ACTIVE / LOCKED | 409, không ghi                         |

Không thay đổi intakeState, role, membership, grants/denials, lịch sử hoặc công việc. Xem danh sách/chi tiết bao gồm mọi trạng thái. Xem/đổi quyền đòi target ACTIVE, không dùng principalFromIdentity để đọc chi tiết tài khoản LOCKED.

## Quyền hiệu lực

Với nhân viên và supplier hiện tại: tập permission đang active trong grants của role trừ tập denial đúng user và supplier. Permission detail hiển thị cả grants hiện ngừng hoạt động với isActive=false và enabled=false. Denial của grant đã bị gỡ được giữ nhưng không hiển thị thành quyền ngoài role; nếu grant được cấp lại, denial vẫn tiếp tục hạn chế.

PUT chỉ thêm denial nếu grant active đang tồn tại; DELETE chỉ xóa denial của grant active đang tồn tại. Grant không tồn tại/inactive trả 400; target không ACTIVE trả 403. Hai thao tác trả trạng thái quyền sau thay đổi; lặp cùng mục tiêu không tạo duplicate hoặc ghi touchUser thừa.

## Projections

- List item: id, username, fullName, email, phone, roleCode, roleName, status.
- Detail/create/status: list item + supplierId, createdAt, updatedAt; thời gian ISO 8601 UTC.
- Permission detail: userId, roleId, permissions[] gồm id, code, name, module, action, description, isActive, enabled.
- Không xuất password/passwordHash, emailVerifiedAt, cấu trúc denial thô, thông tin phiên hoặc các quan hệ không cần cho nghiệp vụ. Map tường minh tại service.

## Transaction invariants

Parent supplier, actor User/Role và target User/Role dùng chung tx và lock order như plan; queries target luôn có supplier + staff ownership filter. User create/status và denial là các mutation riêng theo request, không ghép qua transaction của module cũ. Actor/target recheck sau lock, unique constraints và retry bảo vệ cạnh tranh; test integration chứng minh với quyền bị thu hồi và cascade toàn tổ chức.

## Thay đổi indexes và migration

| Ràng buộc đích              | Cột                   | Predicate / ý nghĩa                                                                    |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| uq_users_non_staff_username | username              | role_code khác INGREDIENT_SUPPLIER_STAFF; mọi non-staff chưa/đã có tổ chức, mọi status |
| uq_users_supplier_username  | supplier_id, username | supplier_id IS NOT NULL; bao gồm admin và staff, mọi status                            |
| users_email_key hiện có     | email Citext          | Unique toàn cục mọi role/org/status, không đổi                                         |

Migration mới supplier_staff_username_scope tạo hai partial indexes trước khi drop UNIQUE constraint users_username_key trong cùng transaction, có timeout theo quy ước repository. Không sửa baseline/manifest/applied migrations, không backfill hoặc đổi tên/ID/hash/timestamp. Khi triển khai, xác minh tên constraint/predicates từ nguồn migration và catalog read-only trên target được phép; nếu không đúng điều kiện thì dừng, không drop bất kỳ object bằng phỏng đoán.

Prisma bỏ global @@unique([username]), biểu diễn hai indexes bằng partialIndexes/map/where raw PostgreSQL chuẩn hóa. Không dùng partial username keys cho findUnique/update unique; thao tác đích dùng id/email hoặc scoped findFirst. Các email/admin/officer unique, FK roleId/roleCode, CHECK tổ chức và indexes khác giữ nguyên.

Tên thư mục migration mới phải tiếp sau migration mới nhất ở lúc triển khai; không lấy ngày plan làm timestamp để chèn trước lịch sử đã có. Cập nhật SCHEMA_BASELINE.md trạng thái thiết kế/kiểm chứng/deploy thực tế, không cập nhật fingerprint baseline gốc để che schema change.

## Login identity cho mọi vai trò và các luồng tạo

Mọi tài khoản SYSTEM/SCHOOL/SUPPLIER/AUTHORITY chỉ dùng email duy nhất + mật khẩu qua POST /api/auth/login. Username vẫn là thuộc tính tài khoản/create/DTO nhưng không dùng để chọn danh tính. Không cần role/orgId/mã/link/selector; sau xác thực, tổ chức/quyền nạp theo User.id từ DB.

Giữ input identifier/password; identifier trim/lowercase theo requiredText(320), password không trim và giữ 1–72 byte cho login tài khoản cũ. Chuỗi non-email hoặc username không rỗng không có email tương ứng nhận 401 chung, không thêm validation định dạng để đổi sang 400; lỗi cấu trúc/thiếu/rỗng/quá dài/trường lạ vẫn 400.

Repository findByEmail dùng findUnique email Citext, trả candidate hoặc null. Bỏ OR username/email, lọc role, take:2, lựa chọn giữa nhiều account và mọi fallback username. Email của A trùng username của B vẫn chỉ trả A; lookup không thấy email thì dummy password comparison và 401. Không sử dụng username/password của B để chọn account A hoặc thay đổi kết quả lookup.

Sau khóa User theo id, đọc lại bản ghi với cùng id + email trong cùng transaction, so email bằng Citext tại DB và kiểm passwordHash chưa đổi. Nếu email/hash đổi sau lookup thì không cấp phiên từ thông tin cũ. Sau đó nạp role/membership/status/onboarding hiện hành; giữ nguyên điều kiện ACTIVE/UNVERIFIED, email verification, quyền và các status bị chặn. JWT/cookie/refresh/logout/recovery tiếp tục userId/email, không theo username.

Staff create duplicate predicate giữ email toàn cục OR username trong trusted supplier; school duplicate predicate giữ email toàn cục OR username trong nhóm non-staff. Signup vẫn dựa non-staff partial unique/P2002. Không bỏ username, đổi default password/role hoặc nới uniqueness khi chuyển toàn hệ thống sang email-only. Teacher lookup theo trường/role chỉ dùng cho nghiệp vụ, không phải nhánh login và không cần xóa.

Generate client và audit unique username selectors trong source/tests để chuyển sang real id/email hoặc scoped findFirst. Mọi positive login fixture/helper, kể cả non-staff, chuyển sang email; giữ username validation/create/uniqueness/DTO tests và thêm negative login. Recovery theo email chỉ đổi đúng User.id, không ảnh hưởng người trùng username. SC-007 kiểm mọi role, email/username cross-field collision, recheck sau lock và status/onboarding không đổi.
