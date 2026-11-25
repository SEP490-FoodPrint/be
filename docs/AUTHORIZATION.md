# Phân quyền FoodPrint

## Chính sách đã chốt

Định mức thực đơn dùng permission hiện có, không thêm role/grant:

| API dưới `/api/menus`                               | Quyền và phạm vi                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET `/ingredient-options/main`                      | `menu.view`, SCHOOL; Ingredient của Supplier ACTIVE có quan hệ ACTIVE với trường                          |
| GET `/ingredient-options/seasoning`                 | `menu.view`, SCHOOL; IngredientEntry ACTIVE, DRY_STOCK của trường, kể cả đang hết hàng                    |
| GET `/days/:menuDayId/meals/:mealType/ingredients`  | `menu.view`, SCHOOL sở hữu thực đơn; định mức và các lô gia vị đã giữ/tiêu hao                            |
| PUT cùng đường dẫn trên                             | `menu.update`, SCHOOL; xác minh lại actor trong transaction, chỉ sửa nháp/được yêu cầu sửa và chưa lập mẻ |
| GET `/days/:menuDayId/meals/:mealType/requirements` | `menu.view`, SCHOOL; nhu cầu theo số suất FINALIZED, tồn khả dụng và thiếu hụt, không tạo reservation     |
| GET `/approval-week`                                | `menu.view`, chỉ Ban Giám hiệu của SCHOOL; phạm vi `listScopes.menu` (trường hiện tại), bỏ thực đơn DRAFT |

PUT thay thế toàn bộ định mức của bữa trong một transaction:

```json
{
  "dishes": [
    {
      "dishId": "<uuid>",
      "ingredients": [
        {
          "ingredientId": "<supplier-ingredient-uuid>",
          "quantityPerPortion": "80",
          "unit": "g"
        }
      ]
    }
  ],
  "seasonings": [
    {
      "ingredientEntryId": "<school-entry-uuid>",
      "quantityPerPortion": "1",
      "unit": "g"
    }
  ]
}
```

Phải khai báo đúng mọi món trong bữa. Nguyên liệu chính dùng Ingredient để chọn từ Supplier trước khi nhận hàng; lúc lập mẻ phải có IngredientEntry và lô khả dụng của trường. Gia vị chọn từ danh mục kho trường, không tự phân loại mọi DRY_STOCK thành gia vị. Định mức dương, tối đa ba chữ số thập phân; đơn vị phải quy đổi được. Không nhận số suất hay tiêu hao do bếp nhập.

CookingBatch đọc định mức riêng của lần lên thực đơn, không fallback sang công thức mẫu. Gia vị giữ một lần theo bữa, kiểm tra dị ứng và dùng chung phép tính tồn khả dụng với nguyên liệu chính. Chi tiết CookingBatch có `mealSeasonings` để truy xuất lô gia vị chung. Khi mọi món đủ số suất và tất cả mẻ hoàn thành, transaction của mẻ cuối trừ gia vị, tạo COOKING_USAGE/MENU_MEAL_SEASONING và đánh dấu used_at. Unique index chống ghi trùng khi retry.

Mỗi tài khoản có một role. Quyền hiệu lực là permission active được gán cho role trừ denial của tài khoản trong tổ chức hiện tại. JWT chỉ xác định tài khoản bằng UUID sub; API nghiệp vụ đọc lại user ACTIVE, role, tổ chức và quyền mỗi request. Không cache quyền và không có System Admin bypass. Riêng API thông tin phiên cho phép tài khoản UNVERIFIED của hai loại đăng ký truy cập giới hạn để tiếp tục hoàn thiện hồ sơ; chưa có quyền nghiệp vụ.

System Admin được thêm permission và sửa bộ quyền mọi role khác, áp dụng toàn hệ thống cho tài khoản mang role đó. Role SYSTEM_ADMIN chỉ đọc qua API; mọi yêu cầu sửa trả 403. Quyền gán mới vẫn chịu ràng buộc phạm vi tài nguyên, không tự cấp quyền truy cập khác tổ chức.

Mỗi trường có tối đa một SCHOOL_ADMINISTRATION, mỗi supplier có tối đa một INGREDIENT_SUPPLIER_ADMIN, tính cả tài khoản inactive. Các role nhân viên có thể có nhiều tài khoản. ATTP xã dùng COMMUNE_FOOD_SAFETY_OFFICER, không có chức năng quản trị quyền, kể cả khi được gán permission quản trị.

Admin tổ chức chỉ bật/tắt quyền role đã có cho tài khoản ACTIVE cùng tổ chức. Tắt tạo denial, bật lại xóa denial; không có bảng lịch sử. Nếu role mất một permission, admin tổ chức không thể cấp lại ngoài role. Denial riêng không bị xóa khi System Admin sửa bộ quyền role.

## Khóa tài khoản và tạm dừng tiếp nhận — feature 013

Các route quản trị `/api/users/:userId/lifecycle`, `/api/users/:userId/deactivate` và `/api/users/:userId/intake-state` yêu cầu SYSTEM_ADMIN thuộc SYSTEM và `user.manage` hiệu lực. Admin trường/NCC bị khóa cùng thành viên nếu không có đơn IN_PROGRESS; cán bộ chỉ bị khóa khi các yêu cầu hướng tới người đó đã CLOSED. Tạm dừng riêng với khóa tài khoản, không ngăn login hay xử lý công việc đã nhận. Các kiểm thử transaction/race trên PostgreSQL và tình trạng triển khai migration cần được xác nhận trước khi phát hành.

`POST /api/supply-requests/:id/accept` yêu cầu SUPPLIER và `supply_request.accept`; `POST /api/food-safety-reports/:id/receive` yêu cầu đúng cán bộ AUTHORITY và `food_safety_report.receive`. Cả hai kiểm tra phạm vi và tạm dừng trong transaction, không dùng quyền xem để ghi. Đọc sự cố/báo cáo của cán bộ lọc theo tài khoản nhận và xã; dữ liệu cũ chưa gắn tài khoản dùng fallback theo xã.

Bootstrap tạo permission `food_safety_report.receive` và chỉ gán mặc định khi role cán bộ được tạo mới. Với role cán bộ đã tồn tại, bootstrap giữ nguyên grants: sau khi operator chạy bootstrap theo đúng chính sách, System Admin cần chủ động cấp quyền mới cho role qua API quản trị đã duyệt. Không tự chạy bootstrap ở startup/CD và không tự bật permission đang inactive.

## HTTP API

### Cấu hình niên khóa của trường

`GET /api/schools/me/academic-years` và `GET /api/schools/me/academic-years/:id` yêu cầu `school_academic_year.view`. `POST` và `PATCH` trên cùng resource yêu cầu `school_academic_year.manage`. Ngoài permission hiệu lực, service bắt buộc role `SCHOOL_MANAGEMENT_BOARD`, tổ chức `SCHOOL` và `schoolId` từ principal; không nhận `schoolId` từ request. Record ngoài trường trả 404. Catalog chỉ khai báo grant mặc định cho Ban Giám hiệu; việc đồng bộ permission vào database đang chạy vẫn là thao tác bootstrap/operator được phê duyệt, không diễn ra khi khởi động API.

### Quản lý khối và lớp học của trường

`GET /api/school-grades`, `POST /api/school-grades`, `PATCH /api/school-grades/:id` và `DELETE /api/school-grades/:id` yêu cầu vai trò Ban Giám hiệu và quyền hiệu lực `class.manage`. Phạm vi trường lấy từ phiên xác thực. Scope nội bộ của SYSTEM có quyền trả bộ lọc rỗng theo quy ước chung, còn service yêu cầu vai trò Ban Giám hiệu cho mọi thao tác.

Tạo và sửa lớp nhận `gradeId` tùy chọn. Gửi `null` để bỏ gán khối. Khi chỉ sửa khối, có thể cập nhật lớp thuộc niên khóa cũ. Danh sách `GET /api/classes` nhận bộ lọc `gradeId` hoặc `gradeId=unassigned`.

`POST /api/classes`, `POST /api/classes/copy`, `PATCH /api/classes/:classId` và `PATCH /api/classes/:classId/status` yêu cầu `class.manage`. Service bắt buộc role `SCHOOL_MANAGEMENT_BOARD`, tổ chức `SCHOOL` và lấy `schoolId` từ principal được nạp lại trong transaction khóa trường; không nhận `schoolId` từ request. Lớp ngoài trường trả 404. Niên khóa phải được cấu hình trong `school_academic_years` của trường và còn là năm hiện tại/sắp tới, nếu không trả 409; tên lớp trùng (không phân biệt hoa thường, tính cả lớp INACTIVE) trả 409. Không có xóa cứng: ngừng hoạt động lớp đóng phân công GVCN hiện tại trong cùng transaction. Catalog chỉ khai báo grant mặc định cho Ban Giám hiệu; đồng bộ vào database vẫn qua bootstrap đã được phê duyệt.

`POST /api/classes/import` (nhập lớp từ Excel, frontend gửi dữ liệu đã đọc dưới dạng JSON) cũng yêu cầu `class.manage` và role Ban Giám hiệu; nếu có dòng điền `teacherUsername` thì cần thêm `class_assignment.manage`. Giáo viên được tra cứu trong chính trường của principal (chỉ tài khoản `HOMEROOM_TEACHER` ACTIVE). `dryRun: true` không ghi gì; lưu khi còn dòng lỗi trả 409, nếu không thì mọi lớp và phân công được tạo trong một transaction.

Dùng envelope hiện có. Thiếu/sai token: 401; không ACTIVE khi gọi API nghiệp vụ hoặc thiếu quyền: 403; tài khoản đích ngoài phạm vi: 404; DTO sai: 400; permission trùng: 409; DB không sẵn sàng: 503.

| API                                                        | Điều kiện/nội dung                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/auth/signup                                      | Tạo user UNVERIFIED, chưa tạo hồ sơ PENDING; Resend gửi mã sau commit; JSON báo verificationEmailSent, không cấp token                                                          |
| POST /api/auth/email-verification/request                  | Body email; gửi/gửi lại mã 6 số qua Resend; giới hạn theo email/IP, thông báo chung                                                                                             |
| POST /api/auth/email-verification/verify                   | Body email/code; cập nhật emailVerifiedAt, giữ UNVERIFIED; không cấp cookie hoặc quyền                                                                                          |
| POST /api/auth/login                                       | Body identifier=email/password cho mọi role; cho phép ACTIVE hợp lệ hoặc UNVERIFIED đã xác minh email; đặt cookie HttpOnly, JSON trả user và expiresIn                          |
| POST /api/auth/refresh                                     | Đọc refresh cookie, kiểm tra hash/TTL và trạng thái user từ DB, đổi refresh token; không tự kích hoạt tài khoản                                                                 |
| POST /api/auth/logout                                      | Thu hồi phiên Redis và xóa cookie                                                                                                                                               |
| GET /api/auth/me                                           | Thông tin tài khoản, status/onboardingRequired và trạng thái hồ sơ; UNVERIFIED không có permissions                                                                             |
| PATCH /api/auth/me                                         | Sửa fullName/phone của chính tài khoản ACTIVE hoặc UNVERIFIED đã xác minh email; không cần user.manage, không sửa email/role/status/tổ chức                                     |
| GET /api/auth/me/permissions                               | Danh sách mã quyền hiệu lực khi ACTIVE; UNVERIFIED nhận mảng rỗng                                                                                                               |
| GET /api/auth/roles                                        | System, role.view; giữ nguyên đường dẫn cũ                                                                                                                                      |
| GET /api/roles                                             | System Admin thuộc SYSTEM, role.view; page/limit; editable=false cho SYSTEM_ADMIN                                                                                               |
| GET /api/permissions                                       | System, permission.view; page/limit/search (tên quyền, không phân biệt hoa/thường)                                                                                              |
| GET /api/permissions/inactive                              | System Admin thuộc SYSTEM, permission.view; chỉ isActive=false, page tùy chọn, cố định 5 mục/trang                                                                              |
| POST /api/permissions                                      | System, permission.create; body code, name, module, action, description tùy chọn                                                                                                |
| PATCH /api/permissions/:permissionId                       | System Admin thuộc SYSTEM, role_permission.manage; chỉ name/description, ít nhất một trường                                                                                     |
| PATCH /api/permissions/:permissionId/state                 | System Admin thuộc SYSTEM, role_permission.manage; body isActive boolean, trạng thái toàn cục                                                                                   |
| GET /api/roles/:roleId/permissions                         | System, role_permission.manage; SYSTEM_ADMIN có editable=false                                                                                                                  |
| PUT /api/roles/:roleId/permissions                         | System, role_permission.manage; body permissionIds là mảng UUID không trùng, quyền thêm mới phải active, quyền inactive đã gán được giữ/thu hồi; role SYSTEM_ADMIN luôn bị chặn |
| GET /api/users/:userId/permissions                         | System có user.manage hoặc admin cùng tổ chức có quyền quản lý tương ứng                                                                                                        |
| PUT /api/users/:userId/permission-denials/:permissionId    | Tắt; school admin có school_user.manage hoặc supplier admin có supplier_staff.manage                                                                                            |
| DELETE /api/users/:userId/permission-denials/:permissionId | Bật lại quyền kế thừa; cùng điều kiện và phạm vi như PUT                                                                                                                        |
| GET /api/schools/:schoolId/accounts                        | SCHOOL (school_user.manage / user.manage), xem danh sách tài khoản nhân viên trường (phân trang page/limit)                                                                     |
| GET /api/schools/:schoolId/accounts/:userId                | SCHOOL (school_user.manage), xem thông tin chi tiết một tài khoản nhân viên trường                                                                                              |
| POST /api/schools/:schoolId/accounts                       | SCHOOL (school_user.manage), tạo tài khoản nhân sự mới cho trường (Bếp, Y tế, GVCN...)                                                                                          |
| PUT /api/schools/:schoolId/accounts/:userId                | SCHOOL (school_user.manage), cập nhật họ tên, SĐT, vai trò nhân sự                                                                                                              |
| PATCH /api/schools/:schoolId/accounts/:userId/status       | SCHOOL (school_user.manage), khóa (LOCKED) hoặc mở khóa (ACTIVE) tài khoản nhân sự                                                                                              |

Quản trị danh mục/role yêu cầu đồng thời SYSTEM_ADMIN, tổ chức SYSTEM và quyền hiệu lực theo bảng; không có bypass. Hai PATCH tái dùng role_permission.manage, không thêm permission/catalog/grant hoặc chạy bootstrap. SYSTEM_ADMIN chỉ đọc **bộ quyền gán**; sửa tên/mô tả và trạng thái chung của permission vẫn được phép với guard phù hợp. Tạm ngừng isActive làm quyền mất hiệu lực ở mọi vai trò, kể cả System Admin, từ request kế tiếp; kích hoạt lại giữ nguyên grants/denials, không cấp lại quyền đã thu hồi hoặc vượt denial. Quyền inactive vẫn xuất hiện trong danh mục/bộ quyền để quản lý. Nếu tự tắt role_permission.manage, request hiện tại có thể thành công còn request quản trị sau bị403; không tự phục hồi. Body/query/params dùng Zod strict với lỗi tiếng Việt tại error.fields; metadata PATCH không cho đổi code/module/action/isActive, description=null để xóa. Các route quản trị trả Cache-Control private, no-store. GET /api/auth/roles giữ hợp đồng cũ.

Ghi dùng thứ tự khóa User → Role IDs → Permission IDs, chọn mode mạnh nhất ngay từ đầu khi target trùng guard; denial tenant giữ thứ tự parent School/Supplier → Users → Roles → Permissions. Đọc actor trực tiếp trong repository để bảo toàn lỗi serialization cho retry. Lưu grants bằng chênh lệch, giữ assignedAt của quan hệ không đổi và không sửa denial; touchRole/touchUser phối hợp MVCC với các module nghiệp vụ. Không hủy tác vụ đã được chấp nhận trước commit đổi quyền. Hợp đồng đầy đủ: [role-permission-api.md](../specs/role-permission-management/contracts/role-permission-api.md).

Các thao tác ghi xác minh lại actor và target trong transaction Serializable, có retry giới hạn cho serialization conflict. PUT/DELETE denial lặp lại an toàn; partial unique index và transaction ngăn tạo bản ghi trùng. Thêm permission vào catalog chưa tự tạo chức năng/API: endpoint phải kiểm tra mã quyền đó.

JWT access dùng HS256, issuer foodprint, audience foodprint-api; JWT_SECRET là bắt buộc. Token mang UUID sub và sid của phiên Redis còn sống; token cũ thiếu sid cần đăng nhập lại. Không đưa role/permissions vào JWT làm nguồn quyết định quyền. Mỗi request kiểm tra phiên Redis rồi tải trạng thái tài khoản và quyền hiện tại từ DB. Redis chứa metadata phiên và hash refresh token, không cache quyền. Xem [cookie, CSRF, TTL, rotation và hợp đồng đăng ký](AUTH_SESSIONS.md). [API hồ sơ theo Figma](ONBOARDING.md) gồm nộp/xem hồ sơ, tài liệu riêng và System Admin duyệt/từ chối. Sau khi nộp vẫn UNVERIFIED; chỉ duyệt thành công mới tạo tổ chức và chuyển ACTIVE. Chưa bổ sung User CRUD tổng quát.

[Xác minh email](EMAIL_VERIFICATION.md) dùng challenge Redis riêng, HMAC-SHA256, hạn 10 phút, tối đa 5 lần thử, tiêu thụ mã nguyên tử. Đây là bằng chứng sở hữu email, không phải trạng thái ACTIVE hay permission. UNVERIFIED chưa xác minh email bị chặn login/refresh/hồ sơ; tài khoản ACTIVE cũ không bị khóa tự động do emailVerifiedAt=null.

Xét duyệt yêu cầu SYSTEM_ADMIN cùng permission được gán: registration.view để xem chi tiết, registration.approve để duyệt, registration.reject để từ chối. Không dùng quyền xem để thay quyền ghi. Các thao tác kiểm tra lại actor/target trong transaction; xung đột serialization PostgreSQL qua Prisma P2034 hoặc P2010/SQLSTATE 40001 được retry giới hạn. Catalog/bootstrap được cập nhật trong code; database đang dùng cần operator bootstrap riêng theo chính sách, không tự thay đổi khi khởi động hay CD.

## Ma trận API danh sách

Cooking Batch Phương án A bổ sung GET `/api/cooking-batches/:id` với `cooking_batch.view`, giữ scope đọc như danh sách; POST `/api/cooking-batches` dùng `cooking_batch.create`, POST `/:id/confirm` dùng `cooking_batch.confirm`, POST `/:id/complete` dùng `cooking_batch.complete`. Thao tác ghi yêu cầu SCHOOL có schoolId tin cậy, xác minh lại actor/quyền trong transaction; SYSTEM không có bypass. Không thêm role/grant/permission. Plan chỉ nhận menuDayId/dishId/mealType; confirm/complete không nhận số suất hoặc lượng nguyên liệu.

Mọi dòng đều yêu cầu một trong các permission liệt kê. SYSTEM có phạm vi toàn hệ thống **khi được gán quyền**, trừ các chức năng giới hạn vai trò được nêu riêng, bao gồm quản lý cơ sở cung cấp và nhân viên nhà cung cấp chỉ dành INGREDIENT_SUPPLIER_ADMIN. Tổ chức khác theo quan hệ sở hữu trong resource-access.ts. Phạm vi dưới đây là org-level, không tự suy diễn lớp được giao cho giáo viên.

| Module                        | Permission (OR)                                                                                                           | Tổ chức ngoài SYSTEM được mở                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                        | `role.view`                                                                                                               | Không                                                                                                                                                               |
| `user`                        | `user.manage`, `school_user.manage`, `supplier_staff.manage`                                                              | SCHOOL, SUPPLIER                                                                                                                                                    |
| `supplier-staff`              | `supplier_staff.manage`                                                                                                   | SUPPLIER, chỉ INGREDIENT_SUPPLIER_ADMIN                                                                                                                             |
| `organization`                | `school.manage`                                                                                                           | SCHOOL                                                                                                                                                              |
| `ingredient`                  | `ingredient.view`, `ingredient.manage`                                                                                    | SCHOOL, SUPPLIER                                                                                                                                                    |
| `menu`                        | `menu.view`                                                                                                               | SCHOOL                                                                                                                                                              |
| `supply-order`                | `supply_request.view`                                                                                                     | SCHOOL, SUPPLIER                                                                                                                                                    |
| `warehouse`                   | `inventory.view`                                                                                                          | SCHOOL, SUPPLIER                                                                                                                                                    |
| `kitchen`                     | `cooking_batch.view`                                                                                                      | SCHOOL                                                                                                                                                              |
| `meal-attendance`             | `daily_meal_portion.view`                                                                                                 | SCHOOL                                                                                                                                                              |
| `feedback`                    | `meal_complaint.view`                                                                                                     | SYSTEM, SCHOOL                                                                                                                                                      |
| `food-safety-incident`        | `food_safety_incident.view`                                                                                               | SYSTEM (tất cả), SCHOOL (BGH: trường; PH/GVCN: hồ sơ mình báo, trừ `SCHOOL_DIRECT`; `SCHOOL_ADMINISTRATION` 403), AUTHORITY (hồ sơ có bản chuyển tới đơn vị/cán bộ) |
| `supplier`                    | `supplier.view`, `supplier.manage`                                                                                        | SUPPLIER, SCHOOL                                                                                                                                                    |
| `authority`                   | `authority.view`, `food_safety_report.view`                                                                               | AUTHORITY                                                                                                                                                           |
| `authority-school`            | `authority_school.view`                                                                                                   | AUTHORITY (`COMMUNE_FOOD_SAFETY_OFFICER`: trường cùng phường/xã với đơn vị)                                                                                         |
| `class`                       | `class.view`                                                                                                              | SCHOOL                                                                                                                                                              |
| `source-facility`             | `source_facility.manage`                                                                                                  | SUPPLIER (chỉ admin)                                                                                                                                                |
| `supplier-certification`      | `supplier_certification.view`                                                                                             | SUPPLIER                                                                                                                                                            |
| `registration`                | `registration.view`                                                                                                       | Không                                                                                                                                                               |
| `school-supplier`             | `supplier_relationship.view`, `supplier_relationship.manage`                                                              | SCHOOL, SUPPLIER                                                                                                                                                    |
| `supplier-school`             | `supplier_relationship.view`, `supplier_relationship.manage`                                                              | SUPPLIER, chỉ INGREDIENT_SUPPLIER_ADMIN                                                                                                                             |
| `ingredient-entry`            | `ingredient.view`, `ingredient.manage`                                                                                    | SCHOOL                                                                                                                                                              |
| `allergy`                     | `class_allergy.view`                                                                                                      | SCHOOL                                                                                                                                                              |
| `delivery`                    | `delivery.view`, `delivery.manage`, `delivery.receive`                                                                    | SCHOOL, SUPPLIER                                                                                                                                                    |
| `dish`                        | `menu.view`                                                                                                               | SCHOOL                                                                                                                                                              |
| `inventory`                   | `inventory.view`                                                                                                          | SCHOOL, SUPPLIER                                                                                                                                                    |
| `retained-sample`             | `retained_sample.view`                                                                                                    | SCHOOL                                                                                                                                                              |
| `meal-allocation`             | `meal_allocation.view`                                                                                                    | SCHOOL                                                                                                                                                              |
| `ingredient-quality-feedback` | `ingredient_quality_feedback.view_own`, `ingredient_quality_feedback.view_details`, `ingredient_quality_feedback.respond` | SCHOOL (chỉ xem), SUPPLIER (`view_details`/`respond`)                                                                                                               |
| `reporting`                   | `food_safety_report.view`                                                                                                 | SCHOOL, AUTHORITY                                                                                                                                                   |
| `authority-complaint`         | `authority_complaint.view`                                                                                                | AUTHORITY (đơn vị nhận), SCHOOL (BGH: trường; vai trò khác: đơn mình gửi)                                                                                           |
| `food-analysis`               | `food_analysis_result.view`                                                                                               | SCHOOL, AUTHORITY                                                                                                                                                   |
| `school-alert`                | `school_alert.view`                                                                                                       | SCHOOL                                                                                                                                                              |
| `menu-review`                 | `menu.view`, `menu.review`, `menu.approve`                                                                                | SCHOOL                                                                                                                                                              |

Cấu hình lưu mẫu (supply-round-sample-planning): `GET|PATCH /api/schools/me/sample-policy` cần `school_sample_policy.manage`, chỉ `SCHOOL_MANAGEMENT_BOARD`, trường lấy từ phiên. Chưa lưu thì trả mặc định 100 g / 150 ml với `isDefault: true`; thấp hơn mức QĐ 1246/QĐ-BYT vẫn lưu, kèm `warnings`. Quyền `cooking_plan.view` (BGH, bếp, kho) và `cooking_plan.approve` (kho) áp dụng tương ứng cho GET /api/supply-rounds và POST /api/supply-rounds/:id/dishes/:dishId/{plan,approve}. Trường lấy từ phiên.

NCC xác nhận lấy thêm qua `POST /api/deliveries/management/:id/top-up` với quyền `delivery.manage` trên chuyến của tổ chức trong phiên. Chuyến chờ lấy thêm phải gửi đúng tập lô và lượng đã duyệt. Gửi lại cùng dữ liệu chuẩn hóa trả 200, dữ liệu khác trả 409. Dispatch chuyến theo đợt yêu cầu `READY_TO_DISPATCH`; chuyến có giai đoạn chuẩn bị NULL tiếp tục dùng luồng hiện tại.

Tỷ lệ hao hụt nguyên liệu (TASK-09): `GET /api/ingredient-entries/waste-rates` liệt kê nguyên liệu ACTIVE của trường kèm `wasteRate`; `PATCH /api/ingredient-entries/:ingredientEntryId/waste-rate` nhận `{ wasteRate }` (0 <= r < 1, tối đa 4 chữ số thập phân). Cả hai cần `ingredient_waste_rate.manage`, cấp cho `SCHOOL_KITCHEN_STAFF`; chỉ tài khoản SCHOOL, phạm vi lấy từ trường của tài khoản; nguyên liệu ngoài trường trả 404. Không lưu lịch sử thay đổi.

Bằng chứng blockchain (`/api/blockchain-proofs`, bảng `blockchain_proofs`): xem danh sách version cần `traceability.view`; gửi lại (`POST …/versions/:versionId/anchor`) và xác minh (`POST …/versions/:versionId/verify`) cần `traceability.verify`, cấp cho `SCHOOL_MANAGEMENT_BOARD` và `SCHOOL_NUTRITION_OFFICER`. Chỉ SCHOOL (theo trường của Delivery, CookingBatch → MenuDay → WeeklyMenu, hoặc trường của ngày phân phối) và SYSTEM; ngoài phạm vi trả 404. Kind gồm `deliveries` (kiểm nhận), `delivery-declarations` (khai báo khi NCC bắt đầu giao), `cooking-batches`, `retained-samples`, `meal-distributions` (`recordId` là một `mealAllocationId` bất kỳ của ngày đó) và `registrations`.

NCC (`INGREDIENT_SUPPLIER_ADMIN`/`INGREDIENT_SUPPLIER_STAFF` có `delivery.manage`) chỉ dùng được kind `delivery-declarations`, giới hạn trong delivery của chính NCC; các kind khác trả 403.

`GET /api/blockchain-proofs/chains/meal-allocations/:mealAllocationId` trả mọi bằng chứng trên chuỗi khai báo → kiểm nhận → mẻ → mẫu → phân phối của một suất ăn, kèm trạng thái liên kết hash giữa các bước. Cần `traceability.view` trong phạm vi trường; thêm `?verify=true` thì cần `traceability.verify` và xác minh từng bằng chứng với chain.

Truy xuất theo khối (đơn vị nhỏ nhất trên giao diện): `GET /api/blockchain-proofs/chains/grade-meals?date=YYYY-MM-DD` liệt kê bữa ăn của ngày theo khối; `GET /api/blockchain-proofs/chains/grade-meals/:gradeId?date=&mealType=LUNCH|AFTERNOON` (`gradeId` là UUID hoặc `none` cho lớp chưa xếp khối) trả hành trình của mọi lớp trong khối. Cần `traceability.view`, thêm `?verify=true` thì cần `traceability.verify`; tài khoản trường chỉ thấy trường mình, `schoolId` chỉ có tác dụng với tài khoản hệ thống (bắt buộc khi xem `none`).

Truy xuất công khai không cần đăng nhập, theo mã trường `ACTIVE`:

- `GET /api/blockchain-proofs/public/schools/:schoolCode/grade-meals?date=YYYY-MM-DD`
- `GET /api/blockchain-proofs/public/schools/:schoolCode/grade-meals/:gradeId?date=YYYY-MM-DD&mealType=LUNCH|AFTERNOON&verify=true|false`

Phản hồi công khai ẩn biển số xe, mã phiếu giao, mã mẻ nấu và lỗi gửi giao dịch. `verify=true` đọc chain nhưng không lưu kết quả kiểm chứng. Khối không có bữa trong ngày của trường trả 404.

Riêng kind `registrations` (hồ sơ đăng ký NCC/trường, UC-01/UC-02) không thuộc trường nào nên chỉ `SYSTEM_ADMIN` thuộc tổ chức SYSTEM được dùng: xem và xác minh cần `registration.view`, gửi lại cần `registration.approve`. Vai trò trường có `traceability.*` vẫn nhận 403.

School xem supplier qua quan hệ ACTIVE/SUSPENDED; ingredient qua IngredientEntry của trường. Supplier xem tài nguyên supplier-owned hoặc delivery của supplier khi có permission phù hợp. ATTP xã chỉ thấy incident/report chuyển tới đơn vị mình; traceability chỉ mở phần liên quan trực tiếp. Với ingredient_quality_feedback.view_own, thêm điều kiện người gửi `senderUserId`; view_details vẫn giới hạn tổ chức. Các API cũ giữ phân trang, safe select và serialization Date/Decimal/BigInt.

- `GET /api/meal-complaints/meal-options` và `POST /api/meal-complaints` yêu cầu `meal_complaint.submit` và vai trò `HOMEROOM_TEACHER` hoặc `PARENTS_COMMITTEE`. Trường, ngày ăn và phạm vi lớp do server xác định.
- `meal_complaint.view` cho phép người gửi đọc đơn của chính mình trong trường và cho phép Ban Giám hiệu đọc đơn của trường. Migration spec 019 bổ sung quyền đọc đang hoạt động cho role `PARENTS_COMMITTEE` đã tồn tại và giữ các thiết lập thu hồi quyền theo tài khoản.
- Đơn khiếu nại là ticket ([specs/complaint-supertype](../specs/complaint-supertype/spec.md)); không thêm mã quyền mới. `POST /api/meal-complaints/:id/accept` và `/:id/resolve` yêu cầu `meal_complaint.respond` và vai trò `SCHOOL_MANAGEMENT_BOARD` của trường sở hữu đơn. `POST /:id/satisfy` và `/:id/reopen` yêu cầu `meal_complaint.submit` và chỉ người gửi đơn được gọi. `POST /:id/comments` nhận cả hai bên: BGH sau khi đã nhận đơn, người gửi khi đơn ở `NEW`/`IN_PROGRESS`/`REOPENED`. Sai trạng thái, quá hạn 48h hoặc thua khi chạy đồng thời trả `409`. Đã bỏ `PATCH /api/meal-complaints/:id`.

## Báo cáo sự cố ATTP (`food-safety-incident`, PR5)

Theo [specs/food-safety-incident-workflow](../specs/food-safety-incident-workflow/spec.md). Quyền mới `food_safety_incident.report` (gán mặc định `PARENTS_COMMITTEE`, `HOMEROOM_TEACHER`); `HOMEROOM_TEACHER` được thêm `food_safety_incident.view`. `PARENTS_COMMITTEE` vốn có `view` nay chỉ thấy hồ sơ mình báo (Q23). Trên DB đã có vai trò, bootstrap chỉ tạo quyền; System Admin cấp `report`/`view` cho phụ huynh và GVCN qua API quản trị quyền.

| Method | Path                                                      | Nhóm được gọi                   | Quyền và phạm vi                                                                                                                                     |
| ------ | --------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/food-safety-incidents`                              | BGH / PH / GVCN / ATTP / System | `view`; phạm vi theo resource `food-safety-incident`; lọc `status`                                                                                   |
| GET    | `/api/food-safety-incidents/:id`                          | Như trên                        | Ngoài phạm vi `404`; `view: REPORTER` (PH/GVCN) hoặc `FULL`                                                                                          |
| POST   | `/api/food-safety-incidents`                              | PH / GVCN                       | `report`; vai trò `PARENTS_COMMITTEE`/`HOMEROOM_TEACHER` (khác `403`); GVCN bắt buộc lớp đang chủ nhiệm (`400`/`403`); trường `ACTIVE`, Serializable |
| POST   | `/api/food-safety-incidents/direct`                       | BGH                             | `create` + `forward`, vai trò `SCHOOL_MANAGEMENT_BOARD`; trường chưa gắn phường/xã, chưa có đơn vị/cán bộ ATTP `ACTIVE` → `409`                      |
| POST   | `/api/food-safety-incidents/:id/forward`                  | BGH                             | `forward`; chỉ từ `PENDING_SCHOOL_REVIEW`; đơn vị nhận như `/direct`; khóa dòng                                                                      |
| POST   | `/api/food-safety-incidents/:id/cancel`                   | BGH                             | `manage`; chỉ từ `PENDING_SCHOOL_REVIEW`; lý do `DUPLICATE_REPORT`/`DATA_ENTRY_ERROR` + ghi chú                                                      |
| POST   | `/api/food-safety-incidents/:id/allocations`              | BGH                             | `manage`; allocation cùng trường (`404`), `DISTRIBUTED`/`FINALIZED` (`409`), hồ sơ chưa đóng/hủy                                                     |
| POST   | `/api/food-safety-reports/:id/receive`                    | Cán bộ ATTP nhận                | Như trước; thêm chuyển hồ sơ `SUBMITTED_TO_AUTHORITY → AUTHORITY_ACKNOWLEDGED`                                                                       |
| GET    | `/api/food-safety-incidents/:id/trace-snapshots/:version` | BGH / ATTP / System             | PR5b; `view` + phạm vi `food-safety-incident`; PH/GVCN `403`; ngoài phạm vi hoặc không có phiên bản `404`; trả payload + `hashMatches`               |

PR5b ([specs/food-safety-incident-trace-snapshots](../specs/food-safety-incident-trace-snapshots/spec.md)): `forward`/`direct` tạo snapshot truy xuất v1; `allocations` sau khi đã gửi ATTP tạo snapshot mới + bản chuyển bổ sung tới đơn vị đang nhận (đơn vị không `ACTIVE` hoặc không có cán bộ `ACTIVE` → `409`). Không có quyền mới.

## Đợt kiểm tra ATTP (`food-safety-inspection`, PR6a)

Theo [specs/food-safety-inspections](../specs/food-safety-inspections/spec.md). Quyền mới `food_safety_inspection.manage` (gán mặc định `COMMUNE_FOOD_SAFETY_OFFICER`); trên DB đã có vai trò, bootstrap chỉ tạo quyền, System Admin cấp cho cán bộ ATTP qua API quản trị quyền. Mọi thao tác chỉ cho cán bộ ATTP thuộc đơn vị đang nhận hồ sơ (khác → `404`), nạp lại actor và khóa dòng hồ sơ.

| Method | Path                                                              | Nhóm được gọi    | Quyền và phạm vi                                                                                                                          |
| ------ | ----------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/food-safety-incidents/:id/inspection-suppliers`             | Cán bộ ATTP nhận | `food_safety_inspection.manage`; NCC trong snapshot truy xuất, hoặc NCC có quan hệ với trường (khác `UNLINKED`) khi snapshot không có NCC |
| POST   | `/api/food-safety-incidents/:id/inspections`                      | Cán bộ ATTP nhận | `manage`; chỉ `AUTHORITY_ACKNOWLEDGED` (→ `UNDER_INSPECTION`) hoặc `UNDER_INSPECTION`; khác → `409`                                       |
| POST   | `/api/food-safety-incidents/:id/inspections/:inspectionId/result` | Cán bộ ATTP nhận | `manage`; ghi một lần (`409` nếu đã có); NCC ngoài danh sách trên → `400`; hết đợt `PLANNED` → `INSPECTION_COMPLETED`                     |
| POST   | `/api/food-safety-incidents/:id/close`                            | Cán bộ ATTP nhận | `manage`; chỉ `INSPECTION_COMPLETED`, mọi đợt đã có kết quả và ≥ 1 đợt (trừ `LEGACY_IMPORT`)                                              |

Chi tiết hồ sơ (`GET /api/food-safety-incidents/:id`) thêm `inspections`: người báo (PH/GVCN) thấy trạng thái, kết quả, kết luận từng NCC và tên/vai trò người ghi, không thấy `teamDescription` (Q23).

## Chế tài NCC theo sự cố ATTP (`supplier-enforcement`, PR6b)

Theo [specs/supplier-enforcement](../specs/supplier-enforcement/spec.md). Quyền mới `supplier_enforcement.request` (gán mặc định `COMMUNE_FOOD_SAFETY_OFFICER`) và `supplier_enforcement.decide` (`SYSTEM_ADMIN`); trên DB đã có vai trò, bootstrap chỉ thêm grant cho `SYSTEM_ADMIN`, System Admin cấp `request` cho cán bộ ATTP qua API quản trị quyền. Resource `supplier-enforcement`: System Admin (`decide`) xem mọi yêu cầu; cán bộ ATTP (`request`) chỉ yêu cầu thuộc hồ sơ đơn vị mình đang nhận; tổ chức khác `403`.

| Method | Path                                                  | Nhóm được gọi     | Quyền và phạm vi                                                                                                                                                                                                                                                                    |
| ------ | ----------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/food-safety-incidents/:id/enforcement-actions`  | Cán bộ ATTP nhận  | `request`; body `{supplierId, actionType: PAUSE_INTAKE\|LOCK_ACCOUNT\|RESTORE, reason (10–2000), evidenceInspectionId?}`; hồ sơ đơn vị khác `404`; `LOCK_ACCOUNT` cần đợt `COMPLETED` có NCC `AT_FAULT` (`409`); `RESTORE` cần hạn chế còn hiệu lực (`409`); một `PENDING` mỗi loại |
| GET    | `/api/supplier-enforcement-actions`                   | System Admin/ATTP | Resource `supplier-enforcement`; lọc `page, limit, incidentId, supplierId, actionType, decisionStatus, executionStatus`                                                                                                                                                             |
| GET    | `/api/supplier-enforcement-actions/:actionId`         | System Admin/ATTP | Ngoài phạm vi `404`; System Admin thấy thêm `activeRestrictions` của NCC                                                                                                                                                                                                            |
| POST   | `/api/supplier-enforcement-actions/:actionId/approve` | System Admin      | `decide`, tổ chức SYSTEM, nạp lại actor; khóa dòng NCC rồi yêu cầu; chỉ `PENDING` (`409`); thực thi ngay (hạn chế, `intakeState`, `LOCKED` + lịch sử); thu hồi phiên sau commit, lỗi → `FAILED`                                                                                     |
| POST   | `/api/supplier-enforcement-actions/:actionId/reject`  | System Admin      | `decide`; body `{note}` bắt buộc; chỉ `PENDING`                                                                                                                                                                                                                                     |
| POST   | `/api/supplier-enforcement-actions/:actionId/retry`   | System Admin      | `decide`; chỉ `LOCK_ACCOUNT` đang `FAILED`; thu hồi lại phiên tài khoản còn bị khóa → `APPLIED`                                                                                                                                                                                     |

`RESTORE` không vượt hạn chế còn hiệu lực khác: chỉ mở tiếp nhận khi NCC hết hạn chế; chỉ mở khóa tài khoản do chính hạn chế bị gỡ khóa và khi không còn `ACCOUNT_LOCKED` khác (còn thì chuyển liên kết sang hạn chế đó). Khi NCC còn `ACCOUNT_LOCKED` hiệu lực: `POST /api/supplier-staff` và `PATCH /api/supplier-staff/:userId/status` → `ACTIVE` trả `409`; khi còn hạn chế bất kỳ: `PATCH /api/users/:userId/intake-state` → `ACTIVE` cho NCC trả `409`.

## Khiếu nại leo thang lên ATTP (`authority-complaint`, C05)

Theo [specs/authority-complaints](../specs/authority-complaints/spec.md). Quyền mới: `authority_complaint.submit` (`PARENTS_COMMITTEE`), `authority_complaint.view` (`PARENTS_COMMITTEE`, `SCHOOL_MANAGEMENT_BOARD`, `COMMUNE_FOOD_SAFETY_OFFICER`), `authority_complaint.respond` (`COMMUNE_FOOD_SAFETY_OFFICER`), `authority.manage` (+ `authority.view`) cho `SYSTEM_ADMIN`. `SCHOOL_ADMINISTRATION` nằm ngoài luồng (Q24). Trên DB đã có vai trò, bootstrap chỉ thêm grant cho `SYSTEM_ADMIN`; quyền C05 của vai trò khác do System Admin gán qua API quản trị quyền.

| Method | Path                                          | Nhóm được gọi          | Quyền và phạm vi                                                                                                                                                                                                                        |
| ------ | --------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT    | `/api/commune-food-safety-units/:id/location` | System Admin           | `authority.manage`, tổ chức SYSTEM, kiểm tra lại trong transaction; `Location.level = 2` đang hoạt động (`400`); phường/xã đã gắn đơn vị khác `409`                                                                                     |
| POST   | `/api/authority-complaints`                   | Phụ huynh gửi C03      | `submit` + `view`; body `{mealComplaintId, reason?}`; C03 của chính người gửi, cùng trường, `RESOLVED` trong 48h, chưa chuyển (`409`); trường chưa gắn phường/xã hoặc chưa có đơn vị ATTP `ACTIVE` `409`; khóa C03 và chạy Serializable |
| GET    | `/api/authority-complaints`                   | ATTP / BGH / phụ huynh | `view`; ATTP: `recipientCommuneFoodSafetyUnitId` của actor; BGH: `schoolId` của actor; vai trò trường khác: `senderUserId = actor.id`; SYSTEM `403`                                                                                     |
| GET    | `/api/authority-complaints/:id`               | Như trên               | Ngoài phạm vi `404`; kèm C03 gốc và bình luận của nó (chỉ đọc)                                                                                                                                                                          |
| POST   | `/api/authority-complaints/:id/accept`        | ATTP đơn vị nhận       | `COMMUNE_FOOD_SAFETY_OFFICER` có `view` + `respond`; từ `NEW`/`REOPENED`                                                                                                                                                                |
| POST   | `/api/authority-complaints/:id/resolve`       | ATTP đơn vị nhận       | Như `accept`; body `{content}`, chỉ từ `IN_PROGRESS`                                                                                                                                                                                    |
| POST   | `/api/authority-complaints/:id/comments`      | ATTP / phụ huynh gửi   | ATTP: như `accept`, ở `IN_PROGRESS`; phụ huynh: `submit`, ở `NEW`/`IN_PROGRESS`/`REOPENED`; BGH `403`                                                                                                                                   |
| POST   | `/api/authority-complaints/:id/satisfy`       | Phụ huynh gửi          | `submit`; trong 48h sau lần giải quyết gần nhất                                                                                                                                                                                         |
| POST   | `/api/authority-complaints/:id/reopen`        | Phụ huynh gửi          | Như `satisfy`; body `{reason?}`                                                                                                                                                                                                         |

## Phường/xã của trường/NCC và trường thuộc địa bàn ATTP

Theo [specs/authority-officer-accounts](../specs/authority-officer-accounts/spec.md). Quyền mới `authority_school.view` (gán mặc định `COMMUNE_FOOD_SAFETY_OFFICER`); vai trò này không còn grant mặc định `dashboard.view` (không có dashboard cho tổ chức `AUTHORITY`). Trên DB đã có vai trò, bootstrap chỉ tạo quyền; System Admin cấp `authority_school.view` và gỡ `dashboard.view` của cán bộ ATTP qua API quản trị quyền. Trường thuộc địa bàn của đơn vị ATTP khi `schools.location_id = commune_food_safety_units.location_id`; không có bảng liên kết, đổi phường/xã của trường đổi quan hệ ngay (bản chuyển sự cố/C05 đã gửi giữ đơn vị nhận cũ).

| Method | Path                                                  | Nhóm được gọi | Quyền và phạm vi                                                                                                                                                                                                                       |
| ------ | ----------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT    | `/api/schools/:schoolId/location`                     | System Admin  | `authority.manage`, tổ chức SYSTEM, kiểm tra lại trong transaction, khóa dòng trường; `Location.level = 2` đang hoạt động (`400`); trường không tồn tại `404`                                                                          |
| PUT    | `/api/suppliers/:supplierId/location`                 | System Admin  | Như trên cho NCC; phường/xã của NCC chỉ là thông tin địa chỉ, không quyết định đơn vị ATTP                                                                                                                                             |
| GET    | `/api/commune-food-safety-units/me/schools`           | Cán bộ ATTP   | Resource `authority-school`: `COMMUNE_FOOD_SAFETY_OFFICER` có `authority_school.view`; trường cùng phường/xã với đơn vị của actor; `page, limit, search, status`                                                                       |
| GET    | `/api/commune-food-safety-units/me/schools/:schoolId` | Cán bộ ATTP   | Như trên; ngoài địa bàn `404`; `suppliers[]`: NCC `ACTIVE` có quan hệ `ACTIVE`/`SUSPENDED` (ẩn `UNLINKED`, NCC ngừng hoạt động); không trả hợp đồng/chứng nhận/tài khoản                                                               |
| POST   | `/api/authority-officers`                             | System Admin  | `authority.manage`, tổ chức SYSTEM, kiểm tra lại trong transaction, khóa dòng phường/xã; body `{locationId, username, password, fullName, phone?}`; phường/xã đã có tài khoản ATTP, tên đăng nhập trùng hoặc đơn vị `INACTIVE` → `409` |
| GET    | `/api/authority-officers`                             | System Admin  | `authority.manage`, tổ chức SYSTEM; lọc `locationId`, `status`, `search`                                                                                                                                                               |
| GET    | `/api/authority-officers/:userId`                     | System Admin  | Như trên; không phải tài khoản ATTP → `404`                                                                                                                                                                                            |

## Khiếu nại gửi System Admin (C06): đã gỡ

Theo [specs/remove-system-complaints](../specs/remove-system-complaints/spec.md), `/api/system-complaints` và quyền `system_complaint.*` đã bị gỡ khỏi phạm vi. Migration `20261209000100_remove_system_complaints` xóa dữ liệu FP-SC, bảng `system_complaints` và chặn đơn `kind = SYSTEM` mới.

## API phân bổ suất ăn hôm nay

- `GET /api/meal-allocations` yêu cầu `meal_allocation.view` trong phạm vi trường. Trả trạng thái nấu, lưu mẫu, dữ liệu lô và phiên bản phân bổ.
- `PUT /api/meal-allocations` yêu cầu `meal_allocation.update`, và `meal_allocation.create` khi tạo hồ sơ lớp. BE kiểm lại điều kiện của bữa được chọn qua mealType LUNCH/AFTERNOON và ghi nguyên tử; thiếu mealType giữ phạm vi cả ngày. GET nhận mealType trong query, PUT nhận trong body. Response có mealType null cho cả ngày, revision ràng buộc phạm vi.
- `POST /api/meal-allocations/confirm-distribution` yêu cầu vai trò `SCHOOL_KITCHEN_STAFF` và quyền hiệu lực `meal_allocation.update`. Xác nhận toàn bộ phân bổ đủ điều kiện trong ngày của trường từ phiên đăng nhập. Yêu cầu `revision` để kiểm tra phiên bản dữ liệu trước khi ghi.
- Dùng ngày ăn hiện tại theo giờ Việt Nam. Hợp đồng này thay các route đọc chi tiết, tạo tự động, xác nhận phân phối và alias v1 của module.

## API Menu và CookingBatch v1

Spec011 đổi lập mẻ sang toàn bữa: POST kitchen nhận `menuDayId`/`mealType` và kiểm tra `dishId` legacy nếu có. BGH quyết định cooking mode; client không được override. GET `/api/v1/kitchen/groups/:id` dùng cùng `cooking_batch.view`, xác thực và phạm vi trường như chi tiết mẻ. Mẻ con chứa `dishes[]`; mẫu lưu và phân bổ suất theo từng món trong mẻ. Confirm/complete/delete vẫn thao tác trên ID mẻ con; kho được ghi một lần theo cặp mẻ/lô nguyên liệu. Xem [hợp đồng grouped cooking](../specs/011-cooking-batch-groups/contracts.md) cho thay đổi response và rollout migration.

Các route `/api/v1/menus`, `/api/v1/kitchen`, `/api/v1/daily-meal-portions` và `/api/v1/food-samples` dùng cùng session cookie, CSRF header, permission runtime và phạm vi trường của API hiện tại. Request ghi cần `X-CSRF-Protection: 1`; trình duyệt gửi cookie với credentials. Không dùng tên role `SCHOOL_ADMIN`/`CHEF` trong tài liệu giao diện để tạo thêm role: mã thực tế là `SCHOOL_ADMINISTRATION` và `SCHOOL_KITCHEN_STAFF`.

| Thao tác                                   | Permission                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Xem thực đơn, định mức, nhu cầu kho        | `menu.view`                                                                                       |
| Đối soát dị ứng theo lớp                   | Cả `menu.view` và `class_allergy.view` để giữ hiệu lực denial trên dữ liệu dị ứng                 |
| Tạo thực đơn                               | `menu.create`                                                                                     |
| Sửa, xóa bản nháp, lưu định mức, gửi duyệt | `menu.update`                                                                                     |
| Duyệt chấp thuận                           | `menu.approve`                                                                                    |
| Yêu cầu chỉnh sửa                          | `menu.review`                                                                                     |
| Xem mẻ, thống kê, dữ liệu in kiểm thực     | `cooking_batch.view`                                                                              |
| Lập, xác nhận, hoàn thành mẻ               | `cooking_batch.create`, `cooking_batch.confirm`, `cooking_batch.complete` tương ứng               |
| Xem, tạo, tiêu hủy mẫu                     | `retained_sample.view`, `retained_sample.create`, `retained_sample.dispose` tương ứng             |
| Tổng hợp số suất đã chốt                   | Một trong `daily_meal_portion.view`, `cooking_batch.view`, `menu.view`; chỉ tổng hợp trong trường |

`POST /api/v1/menus` và `PUT /api/v1/menus/:menuId` nhận cùng cấu trúc dưới đây. `dishId` chọn món của trường; `name` thay thế `dishId` khi nhập tên món. Tên đã tồn tại trong trường dùng lại món đó. Không nhận `schoolId`, trạng thái hoặc tổng số suất từ client. Bản nháp được phép chưa có định mức; gửi duyệt yêu cầu đầy đủ định mức hợp lệ.

```json
{
  "weekStartDate": "2030-01-07",
  "title": "Thực đơn tuần",
  "days": [
    {
      "menuDate": "2030-01-07",
      "note": null,
      "meals": [
        {
          "mealType": "LUNCH",
          "dishes": [
            {
              "name": "Cơm trắng",
              "ingredients": [
                {
                  "ingredientId": "11111111-1111-4111-8111-111111111111",
                  "quantityPerPortion": "80",
                  "unit": "g"
                }
              ]
            }
          ],
          "seasonings": [
            {
              "ingredientEntryId": "22222222-2222-4222-8222-222222222222",
              "quantityPerPortion": "1",
              "unit": "g"
            }
          ]
        }
      ]
    }
  ]
}
```

Ngày phải nằm trong 7 ngày từ `weekStartDate`; tối đa 7 ngày và hai ca `LUNCH`/`AFTERNOON` trong mỗi ngày. PUT gửi đầy đủ các ngày, bữa, món và định mức. Không đổi tuần sau khi tạo. Chỉ ngày nháp chưa từng gửi duyệt mới được bỏ khỏi payload; ngày có lịch sử duyệt phải giữ lại. Khi tuần cần chỉnh sửa, những ngày đã duyệt hoặc đang chờ duyệt phải giữ nguyên, dùng `dishId` từ GET chi tiết. Gửi duyệt lại giữ nguyên các ngày đã duyệt. Yêu cầu chỉnh sửa một ngày không ngăn BGH xử lý các ngày khác còn chờ duyệt. Quyết định `REVISION_REQUESTED` ghi nhật ký duyệt và chuyển trạng thái thực đơn/ngày tương ứng sang `REVISION_REQUIRED`.

GET danh sách menus hỗ trợ `page`, `limit`, `date`, `weekStartDate`, `status`. GET kitchen và kitchen/stats hỗ trợ `date`, `mealType`, `status`, `menuDayId`, `dishId` và phân trang; stats đếm toàn bộ phạm vi bộ lọc. GET daily-meal-portions yêu cầu `date=YYYY-MM-DD` và `mealType`, chỉ cộng bản ghi `FINALIZED`. Danh mục nguyên liệu có `pagination.totalItems`; gia vị dùng IngredientEntry ID, nguyên liệu chính dùng Ingredient ID. UUID trong ví dụ phải thay bằng ID thực lấy từ API danh mục.

POST kitchen trả `batches` đầy đủ; nếu chỉ có một mẻ, trả thêm các trường mẻ ở cấp data để khớp màn hình tạo mẻ. `SEPARATE_BY_LOT` có thể sinh nhiều mẻ; client phải dùng toàn bộ mảng. Gia vị cấp bữa được giữ một lần và tiêu hao khi mọi món/mẻ trong bữa hoàn tất.

Hoàn thành mẻ yêu cầu `inspectionData.step2_Cooking` và `step3_Serving` theo API FINAL. Backend kiểm tra nhiệt độ thực tế tối thiểu 65°C theo yêu cầu ứng dụng và mọi cờ đạt trước khi ghi. Biên bản, trạng thái, tồn kho và inventory transaction commit cùng nhau. Gọi lại cùng biên bản không trừ kho thêm; không cho ghi đè biên bản đã hoàn thành. Body rỗng chỉ dùng để retry mẻ đã COMPLETED, gồm cả lịch sử cũ có inspectionData NULL; không cho hoàn thành lần đầu thiếu kiểm thực qua route cũ.

Mỗi mẻ COMPLETED có tối đa một mẫu. Tạo lại cùng thông tin trả mẫu đã có, không tạo trùng; thông tin khác trả 409. Thời điểm lấy mẫu phải từ lúc hoàn thành mẻ đến hiện tại. `expiresAt` tính từ `sampledAt + 24h`, không phải cột mới. Hủy mẫu yêu cầu cả thời gian server và `disposedAt` đã đủ 24h, không cho thời điểm tương lai; mẫu liên quan sự cố OPEN/INVESTIGATING qua kết quả phân tích hoặc phân phối bữa ăn phải giữ lại. Không tự động hủy khi đủ 48h. Thống kê `pendingSamples` cho biết mẻ hoàn thành chưa lưu mẫu.

Schema hiện tại không có Student, student_allergies hoặc bảng allergens. Allergy-check dùng ClassAllergy/IngredientEntry/Class, trả số lượng theo từng nguyên liệu và lớp; chỉ kết luận có/không có xung đột trong dữ liệu đã ghi nhận. Khi nhiều nguyên liệu có thể trùng học sinh, `totalAffectedStudents` là null và trả `totalAffectedStudentsBounds`, `requiresIndividualDeduplication`. Trường `allergen` null kèm `allergenDataAvailable: false` nghĩa là chưa có dữ liệu phân loại, không xác nhận nguyên liệu an toàn. Không có chức năng gợi ý hoặc suy đoán món/nguyên liệu thay thế. Khi có xung đột, API trả `requiresMenuAdjustment: true`; nhân viên y tế tự quyết định điều chỉnh thực đơn. Chưa triển khai chia suất/mẻ cho món thay thế vì schema chưa có quan hệ phân bổ nhóm dị ứng; planner tiếp tục chặn nhu cầu có dị ứng liên quan để tránh nấu/trừ kho sai.

Phản hồi lỗi v1 bổ sung `code` theo API FINAL; envelope và các route cũ được giữ. Phần API này không thêm migration, seed hay thay đổi role/permission. Backend triển khai phải có migration inspection_data và menu standards đã áp dụng; không chạy SQL bootstrap trên Azure.

## Bootstrap và triển khai

```bash
# Chọn DATABASE_URL local riêng trước khi chạy:
npm run db:migrate:deploy
npm run auth:bootstrap
```

Bootstrap tạo catalog/role còn thiếu, gán defaults cho role mới và quyền khởi tạo của SYSTEM_ADMIN; không tạo tài khoản hoặc mock data. Với role ngoài SYSTEM_ADMIN đã tồn tại, bootstrap không tự gán lại default để giữ những thay đổi runtime. Permission đang inactive không tự bật lại. Catalog ban đầu có thể được System Admin gán tiếp bằng API sau đó.

Azure: review/merge migration và đợi CD PASS trước. Khi được phép thực hiện bước seed riêng, chạy từ commit đã merge:

```bash
AZURE_DATABASE_HOST=foodprint-pg-dev-2026-hm01.postgres.database.azure.com npm run auth:bootstrap -- --azure
```

DATABASE_URL phải là URL Azure đúng foodprint_db/schema foodprint và có SSL. Script mặc định từ chối remote; --azure yêu cầu đúng host và lịch sử migration đã đồng bộ. Không chạy lại SQL nguồn chứa mock data. CD chỉ migrate, không bootstrap.

Migration một admin thêm role_code được FK ghép đối chiếu với roles; ghi SQL ngoài Prisma phải cung cấp role_id/role_code nhất quán và cập nhật timestamp. Tài khoản đăng ký pending có thể tạm chưa có tổ chức; admin ACTIVE phải gắn đúng loại tổ chức. Unique vẫn tính mọi tài khoản đã gắn tổ chức, kể cả inactive. Không sửa migration đã applied. Nếu dữ liệu admin trùng, migration dừng; cần xem xét dữ liệu riêng, không tự reset/xóa/chọn tài khoản.

## Kiểm chứng

```bash
npm run prisma:validate
npm run validate
npm run test:unit
MIGRATION_TEST_DATABASE_URL='<disposable-local-test-url>' npm run test:migrations
MIGRATION_TEST_DATABASE_URL='<disposable-local-test-url>' npm run test:authorization
```

Integration test tạo database mới trong PostgreSQL local test đã chọn; không drop/reset database hiện có hoặc chạy trên Azure. CI chạy cả migration và authorization integration trước khi Backend quality PASS và gọi CD. Test bao gồm JWT role giả, System không có quyền, role SYSTEM_ADMIN bị bảo vệ, role thay đổi trên hai trường, denial riêng, supplier isolation, ATTP, user/permission inactive và ghi admin đồng thời.

## Danh bạ quản trị trường và nhà cung cấp

Danh sách `GET /api/schools` và `/api/suppliers` hỗ trợ `search`, `status`, `page`, `limit`; kết quả bổ sung email/phone/address và pagination.total sau lọc. Giữ scope hiện hành, thứ tự id tăng dần và hasNext.

| GET dưới /api                                      | Quyền                                                                | Phạm vi                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| /schools/summary                                   | school.manage                                                        | SYSTEM_ADMIN thuộc SYSTEM                                  |
| /suppliers/summary                                 | supplier.view hoặc supplier.manage                                   | SYSTEM_ADMIN thuộc SYSTEM                                  |
| /schools/:id                                       | school.manage                                                        | SYSTEM hoặc trường hiện tại                                |
| /suppliers/:id                                     | supplier.view hoặc supplier.manage                                   | Như danh sách supplier, gồm INACTIVE                       |
| /schools/:schoolId/classes                         | class.view                                                           | SYSTEM hoặc trường hiện tại                                |
| /schools/:schoolId/suppliers                       | supplier_relationship.view hoặc supplier_relationship.manage         | SYSTEM, trường hiện tại hoặc quan hệ của supplier hiện tại |
| /schools/:schoolId/accounts                        | user.manage cho SYSTEM; school_user.manage cho SCHOOL_ADMINISTRATION | SYSTEM hoặc admin trường hiện tại                          |
| /suppliers/:supplierId/certifications              | supplier_certification.view                                          | SYSTEM hoặc supplier hiện tại                              |
| /supplier-certifications/:id/documents/:documentId | supplier_certification.view                                          | SYSTEM hoặc supplier sở hữu chứng nhận                     |

Nhóm con dùng quyền riêng, không yêu cầu thêm quyền hồ sơ parent. Parent ngoài phạm vi/không tồn tại trả 404; parent hợp lệ nhưng không có dữ liệu trả danh sách rỗng và total=0. Summary không nhận bộ lọc và đếm total/activeCount toàn phạm vi. Không có System Admin bypass permission.

Tệp chứng nhận được xác minh qua anchor hồ sơ APPROVED/SUPPLIER và nhóm certificate_N; quyền sở hữu theo chứng nhận hiện tại, không theo tổ chức hiện tại của applicant. Response danh sách chỉ chứa metadata an toàn, mở tệp trả URL 60 giây và Cache-Control no-store. API review hồ sơ giữ quyền registration.view riêng. Hợp đồng đầy đủ: [admin-directory.md](../specs/006-school-supplier-admin/contracts/admin-directory.md).

## Quản trị nguyên liệu nhà cung cấp

Nhóm `/api/ingredients/management` yêu cầu tài khoản ACTIVE, role `INGREDIENT_SUPPLIER_ADMIN`, tổ chức SUPPLIER hợp lệ đang ACTIVE và permission hiệu lực `ingredient.manage`. Staff bị chặn kể cả được gán permission này; System Admin không có bypass. Mỗi lần ghi nạp lại actor/quyền/membership và supplier trong cùng Serializable transaction với kiểm tra target/category và mutation.

| Method | Endpoint                                         | Kết quả                                                          |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------- |
| GET    | /api/ingredients/management                      | Nguyên liệu thuộc supplier hiện tại, gồm ACTIVE/INACTIVE         |
| GET    | /api/ingredients/management/categories           | Danh mục dùng chung chỉ đọc                                      |
| GET    | /api/ingredients/management/:ingredientId        | Chi tiết thuộc sở hữu                                            |
| POST   | /api/ingredients/management                      | Tạo nguyên liệu ACTIVE, tự gắn supplier                          |
| PATCH  | /api/ingredients/management/:ingredientId        | Sửa trường editable, giữ trạng thái                              |
| PATCH  | /api/ingredients/management/:ingredientId/status | Đặt ACTIVE/INACTIVE; gọi lại cùng trạng thái không đổi timestamp |

Danh sách chỉ nhận page/limit, mặc định 1/20, limit tối đa 100, envelope items/pagination.hasNext hiện hành. Scope từ principal, không từ supplierId do client gửi. Target ngoài sở hữu và không tồn tại cùng 404. Trùng tên trong cùng supplier kể cả đang ẩn trả 409. Quyền đọc GET `/api/ingredients` hiện có giữ nguyên, gồm staff được cấp quyền đọc hợp lệ.

Input tạo/sửa chỉ gồm name/defaultUnit/description/categoryId/coverImage/imageDescription; tạo cần name và defaultUnit. PATCH bỏ qua giữ nguyên, null xóa trường nullable, [] xóa danh sách ảnh. coverImage tối đa một tham chiếu; imageDescription nhiều tham chiếu theo thứ tự. Chấp nhận URL HTTP/HTTPS không credentials hoặc đường dẫn bắt đầu /, tối đa 2048 ký tự. categoryId nullable tham chiếu danh mục có sẵn; chưa có API quản trị danh mục. Chi tiết input/output tại [contract](../specs/008-supplier-ingredient-management/contracts/ingredient-management.md).

Đổi trạng thái nhận body `{ "status": "ACTIVE" }` để hiện lại hoặc `{ "status": "INACTIVE" }` để ẩn. Thao tác giữ lịch sử và quyền sở hữu; target ngoài sở hữu trả 404 như không tồn tại. Contract [đổi trạng thái](../specs/ingredient-change-status/contracts/ingredient-status-api.md) thay thế endpoint hide trong contract cũ.

Hai API `POST /api/ingredients/management/upload-image` và `POST /api/ingredients/management/upload-images` nhận multipart lần lượt một ảnh `image` hoặc từ một đến năm ảnh `images` (JPEG/PNG/WebP, tối đa 5 MiB mỗi ảnh). API dùng cùng quyền quản trị nguyên liệu; upload trước khi tạo/sửa và trả URL để gửi trong body JSON riêng. Single trả 201; batch trả 200 và kết quả thành công/thất bại cho từng tệp theo thứ tự. Chi tiết tại [contract upload](../specs/ingredient-image-upload/contracts/ingredient-upload-api.md).

Ẩn không xóa dữ liệu hoặc thay đổi hồ sơ đã có. Lựa chọn nguyên liệu mới và supplier discovery chỉ dùng nguyên liệu ACTIVE; menu/hợp đồng/lịch sử kho vẫn đọc được liên kết cũ. Các phản hồi legacy giữ category dạng tên/null suy ra từ quan hệ, không giữ thêm cột category trong DB.

## Kiểm tra từng đợt giao nguyên liệu

Màn dùng chung cho `SCHOOL_NUTRITION_OFFICER`, `SCHOOL_KITCHEN_STAFF`, `INGREDIENT_MANAGEMENT_DEPARTMENT`, `PARENTS_COMMITTEE`. Ngoài role hợp lệ, cần quyền hiệu lực trong trường hiện tại; không dùng role/school/user do client gửi.

| Method | Endpoint                         | Quyền                                                                                    |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/deliveries/inspections`    | `delivery.view`; lọc tùy chọn `orderType`, `batchNo`; response có `orderType`, `batchNo` |
| GET    | `/api/deliveries/:id/inspection` | `delivery.view`                                                                          |
| POST   | `/api/deliveries/:id/arrival`    | `delivery.view` và `delivery.inspect`                                                    |
| POST   | `/api/deliveries/:id/inspection` | `delivery.inspect` và `delivery.view`                                                    |

`POST /api/deliveries/:id/arrival` chỉ dành cho bốn vai trò kiểm nhận thuộc đúng trường của đợt giao (chặn nhà cung cấp, truy cập public và tài khoản ngoài trường bằng `403`/`404`, chặn đơn/nguồn đã hủy hoặc đang ở `PREPARING` bằng `409`), chỉ áp dụng cho đơn `traceabilityVersion = 1` đang `IN_TRANSIT` để chuyển `IN_TRANSIT -> ARRIVED` với `arrivedAt` do server ghi nhận; gọi lại khi đã qua bước nhận nơi giữ nguyên trạng thái và timestamp ban đầu. Danh sách nhận `page`, `limit`, `search`, `status`, `period` (`ALL`, `today`, `week`); tìm/lọc/phân trang và thống kê cùng phạm vi tại BE. Ngày/tuần dùng múi giờ Việt Nam. GET `/api/deliveries` cũ giữ nguyên. Chi tiết kiểm nhận trả thêm `traceabilityVersion`, `statusLabel` và snapshot `deliveryItems[].sourceFacility` (`id`, `name`, `facilityCode`).

POST chỉ nhận `decision` (`APPROVE`/`REJECT`) và `reason`; từ chối bắt buộc có lý do. Một quyết định bất biến cho mỗi role trên mỗi Delivery. Cùng actor gửi lại đúng nội dung không tạo thêm bản ghi; đổi nội dung hoặc người khác ký cho role đã ghi trả 409. Mỗi lần giao mới cần kiểm tra mới, không dùng lại chữ ký đợt trước.

Chỉ kiểm tra khi `ARRIVED`/`PENDING_APPROVAL` (trả `409` nếu đang `PREPARING` hoặc trạng thái khác). Đủ bốn bên đồng ý mới chuyển `RECEIVED`, mở các lot hợp lệ và ghi đúng một `RECEIPT` mỗi lot trong cùng transaction. Không nhận vượt lượng yêu cầu, sai trường/Supplier/đơn, sai tổng lot/đơn vị/ngày hoặc lot đã có lịch sử kho. Khi đơn `REQUEST` phân bổ nhiều dòng cùng `supplyRequestItemId`, service gom tổng Decimal từng nhóm và cộng `previous RECEIVED` đúng 1 lần mỗi nhóm: đơn `workflowVersion = 2` bắt buộc đủ tập dòng nguồn và `currentGroup == requested` với đúng `ingredientId`/`ingredientEntryId`/`unit`; đơn legacy giữ kiểm tra `previous + currentGroup <= requested`.

Giới hạn giao lại (`cap3`) tính chung theo `SupplyRequest`: số Delivery có ít nhất một quyết định `REJECT` thuộc mọi đơn `REQUEST` (bao gồm cả `workflowVersion = 2`, `traceabilityVersion = 1` và đơn `REQUEST` legacy `traceabilityVersion = null`; chỉ đơn `STANDALONE` không gắn `SupplyRequest` là không đếm). Lần từ chối thứ ba hủy `SupplyRequest` và các đợt còn chờ (`PREPARING`, `IN_TRANSIT`, `ARRIVED`, `PENDING_APPROVAL`), chặn nhận tiếp; giữ nguyên đợt `RECEIVED` và kho/lịch sử đã ghi. GET/POST trả `redeliveryRequiredCount`, `redeliveryLimit`, `cancellationNotice`, `currentRole`, `requiredRoles`, `canInspect`; thông báo hủy hiển thị bền vững trên màn chung. Việc lập lịch/tạo chuyến giao lại phía Supplier nằm ngoài màn kiểm tra này.

Migration `20261114000200_delivery_inspection_permissions` cấp `delivery.inspect` cho bốn role và bổ sung `delivery.view` cho Ban phụ huynh; giữ nguyên permission đang bị tắt và user denials. `delivery.evaluate_quality` vẫn là quyền đánh giá chất lượng riêng.

# School dish categories

`GET /api/dishes/categories` uses `menu.view`; `POST /api/dishes/categories` uses `menu.create`; `PUT` and `DELETE /api/dishes/categories/:id` use `menu.update`. Every operation resolves the school from the authenticated principal and rechecks permission in the school transaction. A category referenced by any dish cannot be deleted. Dish catalog and menu detail return the school's category ID and current name.

Các mutation của account lifecycle và intake guard khóa Role actor bằng FOR SHARE sau các khóa School/Supplier/User và trước resource. Thay denial cập nhật version User khi có thay đổi; thay grants cập nhật version MVCC Role bằng no-op SQL không đổi dữ liệu role. Cơ chế này buộc Serializable transaction có snapshot quyền cũ retry khi thay quyền đã commit trước bước khóa, rồi kiểm tra quyền mới trong cùng transaction. Không đổi JWT hoặc cache quyền.

## Quản lý cơ sở cung cấp của nhà cung cấp

Cả năm endpoint dưới đây yêu cầu tài khoản ACTIVE, vai trò INGREDIENT_SUPPLIER_ADMIN, membership SUPPLIER hợp lệ, nhà cung cấp ACTIVE và quyền hiệu lực source_facility.manage. Staff và SYSTEM bị chặn kể cả được gán quyền; không có scope toàn hệ thống cho chức năng này.

| Method | Endpoint                                            | Hành vi                                                                      |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | /api/source-facilities                              | Danh sách của supplier hiện tại, gồm ACTIVE/INACTIVE, phân trang page/limit. |
| GET    | /api/source-facilities/:sourceFacilityId            | Chi tiết bằng UUID, có địa chỉ và thông tin liên hệ.                         |
| POST   | /api/source-facilities                              | Thêm cơ sở, hệ thống tự cấp mã riêng trong supplier.                         |
| PATCH  | /api/source-facilities/:sourceFacilityId            | Sửa tên/địa chỉ/liên hệ, giữ mã và chủ sở hữu.                               |
| POST   | /api/source-facilities/:sourceFacilityId/deactivate | Dừng hoạt động; dừng lặp thành công.                                         |

Scope chỉ lấy từ principal đã xác thực và áp vào WHERE của repository. Target ngoài supplier và target không tồn tại cùng trả 404. Mọi write nạp lại actor/quyền/membership, kiểm tra supplier và khóa target trong cùng Serializable transaction với mutation.

facilityCode do hệ thống sinh theo dãy riêng mỗi supplier, bắt đầu FP-SF-00001; supplier khác được phép có cùng mã, nên mã không thay UUID trong đường dẫn. Người dùng không nhập/sửa mã, supplierId, trạng thái hoặc audit. Không xóa hoặc kích hoạt lại; dừng giữ isVisible, mã và liên kết lô nguyên liệu. Mã legacy null/không chuẩn được giữ nguyên.

Hợp đồng chi tiết: [Source Facility API](../specs/027-source-facility-management/contracts/source-facility-api.md).

## Tiếp nhận yêu cầu nguyên liệu phía nhà cung cấp

| Endpoint                               | Quyền và phạm vi                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/supply-requests`             | Lọc tùy chọn `orderType` (`DIRECT_USE`/`DRY_STOCK`), `batchNo` (1/2); response có `orderType`, `batchNo`, `orderTypeLabel`, `batchLabel`. `supply_request.view`; SUPPLIER chỉ admin/staff hiện tại, chỉ đơn của nhà cung cấp ngoài DRAFT; SCHOOL/SYSTEM giữ scope và projection cũ. |
| GET `/api/supply-requests/:id`         | `supply_request.view`; chỉ INGREDIENT_SUPPLIER_ADMIN/INGREDIENT_SUPPLIER_STAFF thuộc SUPPLIER, đúng supplierId và ngoài DRAFT.                                                                                                                                                      |
| POST `/api/supply-requests/:id/accept` | `supply_request.accept`; cùng hai role supplier, xác minh lại quyền/membership/trạng thái trong Serializable transaction. Không yêu cầu quyền view.                                                                                                                                 |

Nhánh danh sách SUPPLIER hỗ trợ `status` trong SENT/ACCEPTED/IN_PROGRESS/COMPLETED/CANCELLED; mặc định cả năm trạng thái. Giữ page mặc định 1, limit mặc định 20/tối đa 100 và hasNext; thêm schoolName, requestedDeliveryDate, sentAt và projection `orderProgress` (`ACCEPTED`/`IN_PROGRESS` chưa có `Delivery` -> `stage = CONFIRMED`, `statusLabel = "Đã xác nhận"`, `deliveryId = null`, `nextAction = ADD_INGREDIENTS` khi đủ quyền `delivery.manage`; có đúng một `Delivery` `creationMode = REQUEST` -> phản ánh trạng thái `Delivery` và `nextAction`; legacy nhiều đợt không có `REQUEST` duy nhất hoặc chưa tiếp nhận/đã đóng chưa có `Delivery` -> `null`). SCHOOL/SYSTEM vẫn chỉ nhận page/limit, giữ projection cũ và không trả `orderProgress`, gửi status trả 400; trường vẫn xem được bản nháp của chính mình theo quyền. Không lấy supplierId/schoolId từ query để mở rộng scope.

Chi tiết trả đủ dòng kể cả nguyên liệu/entry đã ngừng hoạt động. Số lượng là chuỗi Decimal, đơn vị lấy từ dòng đơn, ngày giao YYYY-MM-DD, timestamp ISO và dữ liệu thiếu giữ null. Người nhận biểu diễn bằng acceptedByUserId, không trả hồ sơ tài khoản, email/phone hay contractSnapshot. Ngoài scope/không tồn tại/DRAFT đều 404 với detail/accept.

Nhận mới chỉ SENT -> ACCEPTED (nhãn nghiệp vụ `"Đã xác nhận"`), ghi người/thời điểm cùng transaction và chưa tạo `Delivery`. Supplier tạm dừng hoặc admin một bên DEACTIVATED ngăn nhận mới; school tạm dừng tạo đơn không ngăn nhận đơn đã gửi. ACCEPTED/IN_PROGRESS trả receipt bốn trường cũ sau kiểm tra quyền và scope, không ghi đè thông tin đầu tiên hoặc updatedAt, kể cả khi supplier đã tạm dừng. COMPLETED/CANCELLED trả 409. Quyền bị tắt cho từng người vẫn có hiệu lực, không bypass SYSTEM và không cache phân quyền.

Thiết kế và hợp đồng: [supplier-order-intake](../specs/supplier-order-intake/contracts/supply-requests.md). Không thêm schema hoặc quyền mới; kết quả kiểm chứng thực tế được ghi tại [quickstart](../specs/supplier-order-intake/quickstart.md).

## Tạo và quản lý đơn giao hàng phía nhà cung cấp

| Endpoint                                                   | Quyền và phạm vi                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/deliveries/management/options/schools`           | `delivery.manage`; chỉ `INGREDIENT_SUPPLIER_ADMIN` / `INGREDIENT_SUPPLIER_STAFF` thuộc SUPPLIER; lọc trường `ACTIVE`, `intakeState = ACTIVE`, admin hoạt động và quan hệ `ACTIVE`; hỗ trợ `search` (trim ≤100, escape `\`, `%`, `_`, `OR` name/code AND scope), projection an toàn `{ id, code, name }`.                      |
| GET `/api/deliveries/management/options/ingredients`       | `delivery.manage`; hai vai trò supplier hiện hành; lọc nguyên liệu `ACTIVE` thuộc đúng `supplierId` từ membership (strict paging, từ chối `search`).                                                                                                                                                                          |
| GET `/api/deliveries/management/options/source-facilities` | `delivery.manage`; hai vai trò supplier hiện hành; lọc cơ sở cung cấp `ACTIVE` thuộc đúng `supplierId` (bao gồm `facilityCode = null` và `isVisible = false`), chỉ trả `id`, `name`, `facilityCode`, không lộ liên hệ (strict paging, từ chối `search`).                                                                      |
| POST `/api/deliveries/management`                          | `delivery.manage` + header `Idempotency-Key` (UUID bắt buộc); **không** nhận `expectedArrivalAt`/`vehiclePlate` (kể cả `null`); nhận phân bổ nhiều nguồn theo `(supplyRequestItemId, sourceFacilityId, actualQuantity)` cho `REQUEST` hoặc `items` `(ingredientId, sourceFacilityId, actualQuantity, unit)` cho `STANDALONE`. |
| POST `/api/deliveries/management/:id/dispatch`             | `delivery.manage`; hai vai trò supplier hiện hành; body strict `{ expectedArrivalAt, vehiclePlate }`, chuyển `PREPARING -> IN_TRANSIT` một lần trên `workflowVersion = 2` (replay cùng metadata chuẩn hóa trả `200`, sai khác trả `409`).                                                                                     |
| GET `/api/deliveries/management`                           | `delivery.view` **hoặc** `delivery.manage` **hoặc** `delivery.receive`; hai vai trò supplier hiện hành, chỉ đọc delivery thuộc `supplierId` của tài khoản, hỗ trợ lọc `status` gồm cả `PREPARING`, kèm `workflowVersion`, `statusLabel`, `nextAction`; không trả PNG, `qrToken` hay idempotency metadata.                     |
| GET `/api/deliveries/management/:id`                       | `delivery.view` **hoặc** `delivery.manage` **hoặc** `delivery.receive`; hai vai trò supplier hiện hành; gồm `workflowVersion`, `traceabilityVersion`, `statusLabel`, `nextAction`, `traceUrl` và từng dòng allocation riêng theo UUID (không collapse); legacy giữ `null`; ngoài supplier trả `404`.                          |
| GET `/api/deliveries/management/:id/labels`                | `delivery.view` **hoặc** `delivery.manage` **hoặc** `delivery.receive`; áp dụng từ trạng thái `PREPARING` trở đi cho đơn `traceabilityVersion = 1` (legacy `null` trả `409`); phân trang `page`/`limit` trả `data:image/png;base64,...` dựng từ `qrUrl` đã lưu, không tạo lại URL/token; lỗi renderer trả `503`.              |

Nhánh `REQUEST` yêu cầu `SupplyRequest` thuộc supplier hiện hành ở trạng thái `ACCEPTED` hoặc `IN_PROGRESS` (còn thực hiện được) chưa có bất kỳ `Delivery` nào trước đó; mỗi dòng nguồn `sources` chỉ định `(supplyRequestItemId, sourceFacilityId, actualQuantity)` theo chuỗi Decimal dương (không cho phép trùng `(supplyRequestItemId, sourceFacilityId)` hoặc trùng cặp `(ingredientId, sourceFacilityId)` sau khi resolve nguồn); service gom nhóm và buộc tổng từng `supplyRequestItemId` phủ đủ mọi dòng nguồn và bằng đúng `requestedQuantity`, ghi toàn bộ dòng phân bổ với `Delivery.schoolId` chuẩn hóa và chuyển `ACCEPTED -> IN_PROGRESS` cùng transaction qua guard `START_ORDER_PROCESSING`. Nhánh `STANDALONE` tìm/chọn trường qua `GET /options/schools` (tìm kiếm chỉ đọc, **không** có trạng thái `CONFIRMED`/`"Đã xác nhận"` và không tạo `SupplyRequest`); khi `POST` kiểm tra `SUPPLIER_CREATE_STANDALONE_DELIVERY` (recheck supplier, trường, quan hệ `ACTIVE` và nguyên liệu), cho phép lặp `ingredientId` khác `sourceFacilityId` (unique trên `(delivery_id, ingredient_id, source_facility_id)` với tối đa 100 dòng, mỗi dòng giữ lượng/nguồn/UUID riêng), khớp `defaultUnit`, chỉ liên kết `IngredientEntry` `ACTIVE` sẵn có (`null` nếu chưa có). Mỗi đơn `workflowVersion = 2`, `traceabilityVersion = 1` khởi tạo ở `PREPARING` (`statusLabel = "Đang chuẩn bị hàng"`, `expectedArrivalAt = null`, `vehiclePlate = null`, `nextAction = ENTER_SHIPPING` khi đủ quyền), nhận mã `FP-DE-00001` riêng theo supplier, `qrToken` hex64 và `qrUrl` theo từng dòng `DeliveryItem` không gộp; bước `POST /:id/dispatch` kiểm tra continuation policy, gán `expectedArrivalAt`/`vehiclePlate` và chuyển `IN_TRANSIT` (`statusLabel = "Đang giao hàng"`, `nextAction = TRACK_DELIVERY`).

Idempotency của `POST /api/deliveries/management` sử dụng khóa bền vững `(supplier_id, created_by_user_id, creation_key)` cùng SHA-256 `creationFingerprint` canonical **v3** (chuẩn hóa `actualQuantity`, `note`/`unit`, sắp xếp `sources` theo `(supplyRequestItemId, sourceFacilityId)` hoặc `items` theo `(ingredientId, sourceFacilityId)`): trùng khóa và trùng nội dung xác minh lại tài khoản/quyền/scope sống (không phụ thuộc QR renderer/origin hay trạng thái `ACTIVE` về sau của nguyên liệu/cơ sở nguồn) trước khi trả HTTP `200` với trạng thái hiện tại; khác nội dung trả `409`; khóa cũ `workflowVersion = null` không được nâng cấp và trả `409`; không bao giờ lộ `creationKey` hay `creationFingerprint`. Trên luồng tiếp nhận phía trường (`/api/deliveries...`, `/api/ingredient-lots`, kitchen và menu), scope trường dùng trực tiếp `Delivery.schoolId`; duyệt bước cuối của đơn `REQUEST`/`STANDALONE` `v1` (`workflowVersion = 2` hoặc legacy) yêu cầu mọi lô khớp `item.sourceFacilityId`, gắn `IngredientEntry` `ACTIVE` cho `STANDALONE` (`409` nếu chưa có), mở tồn kho đúng 1 lần (`RECEIVED`, `statusLabel = "Hoàn thành"`); khi `REJECT` (`statusLabel = "Yêu cầu giao hàng lại"`), **chỉ đơn `STANDALONE`** (`supplyRequestId = null`) là không đếm hay hủy `SupplyRequest`, còn mọi đơn `REQUEST` (bao gồm `workflowVersion = 2`, `v1` và legacy) đều tính vào giới hạn `cap3` tối đa 3 lần giao lại.

### Truy xuất nguồn gốc công khai qua tem QR (`delivery-trace`)

| Endpoint                                       | Quyền và phạm vi                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET / HEAD `/api/public/delivery-items/:token` | **Ngoại lệ công khai (không cần đăng nhập)** trước các route cần xác thực; nhận `Accept` `text/html` hoặc `application/json` (khác trả `406`); sai token/legacy cùng trả `404`. |

Bản ghi công khai JSON chỉ trả đúng 8 trường trong allowlist (`supplierName`, `deliveryNo`, `status`, `statusLabel`, `ingredientName`, `actualQuantity`, `unit`, `sourceFacility: { name, facilityCode }`) với `status`/`statusLabel` phản ánh cả `PREPARING`; giao diện HTML escape toàn bộ ký tự đặc biệt; cả hai định dạng tuyệt đối không lộ tên trường, biển số xe, lịch giao, `workflowVersion`, `nextAction`, hợp đồng, ghi chú, thông tin liên hệ cơ sở/nhà cung cấp, danh sách chữ ký hay token, và áp dụng `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, `Content-Security-Policy`. Request/error logger che `qrToken` trên mọi đường dẫn `/api/public/delivery-items/...`. Khi triển khai, bắt buộc áp dụng tuần tự enum migration (`20261118000200_delivery_preparing_status`) rồi schema/CHECK/3 partial unique index (`20261118000300_supplier_order_stages`) trước khi phát hành backend/client `workflowVersion = 2` (tạm dừng writer cũ tạo thẳng `IN_TRANSIT`, giữ cố định `PUBLIC_TRACE_ORIGIN`, không seed/cấp quyền ngầm). Nếu cần rollback ứng dụng sau khi đã phát sinh đơn nhiều nguồn hoặc `PREPARING`, phải review tương thích trước và **không** gộp QR/dòng hàng hay khôi phục hai full unique index cũ.

Thiết kế và hợp đồng: [supplier-orders](../specs/supplier-order-creation/contracts/supplier-orders.md) và [public-trace](../specs/supplier-order-creation/contracts/public-trace.md). Kết quả kiểm chứng được ghi tại [quickstart](../specs/supplier-order-creation/quickstart.md).

## Quản lí nhân viên nhà cung cấp

Module `supplier-staff` yêu cầu actor ACTIVE, INGREDIENT_SUPPLIER_ADMIN thuộc SUPPLIER có membership hợp lệ và quyền hiệu lực `supplier_staff.manage`. SYSTEM/staff hoặc admin thiếu quyền đều bị từ chối. Scope lấy từ principal; target chỉ INGREDIENT_SUPPLIER_STAFF thuộc supplier hiện tại, role type SUPPLIER. Không nhận organization/role để mở rộng phạm vi.

| Method | Path                                                           | Hành vi                                                                                    |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/supplier-staff`                                          | Mọi trạng thái; page/limit mặc định 1/20, tối đa100, hasNext; createdAt desc rồi id asc    |
| GET    | `/api/supplier-staff/:userId`                                  | Detail mọi trạng thái, safe fields và ISO timestamps                                       |
| POST   | `/api/supplier-staff`                                          | Tạo ACTIVE đúng supplier/role, mật khẩu khởi tạo bcrypt12; không registration hoặc session |
| PATCH  | `/api/supplier-staff/:userId/status`                           | ACTIVE ↔ LOCKED; same-state không ghi, trạng thái khác409                                  |
| GET    | `/api/supplier-staff/:userId/permissions`                      | Chỉ target ACTIVE; grants hiện có gồm inactive, enabled = active trừ scoped denial         |
| PUT    | `/api/supplier-staff/:userId/permission-denials/:permissionId` | Tắt riêng một grant active thuộc role                                                      |
| DELETE | `/api/supplier-staff/:userId/permission-denials/:permissionId` | Bật lại bằng xóa đúng denial, giữ trần role                                                |

Target ngoài phạm vi/admin/không tồn tại cùng404; permission target trong phạm vi nhưng không ACTIVE trả403, permission thiếu/inactive/ngoài role trả 400. Body/query/params strict; không raw input, hash hoặc secret trong output. Username staff case-sensitive duy nhất trong supplier kể cả admin và mọi status; staff khác supplier được trùng. Email Citext duy nhất toàn cục; duplicate409 chung không tiết lộ chủ sở hữu. Mọi vai trò login email-only theo [AUTH_SESSIONS.md](AUTH_SESSIONS.md).

Write cùng Serializable transaction, khóa Supplier → User IDs → Role IDs rồi kiểm lại actor/target, scope và quyền; retry tối đa ba lần. Toggle denial lặp an toàn, chỉ touch User khi dữ liệu đổi, không sửa RolePermission. Đọc quyền dùng cùng RepeatableRead snapshot. Khóa tác động login/refresh/request tiếp theo, giữ denial/history/công việc; intake tạm dừng không tự cấm quản lí staff. Generic user/permission APIs giữ hợp đồng riêng; client tính năng này dùng bảy route chuyên biệt trên. Chi tiết request/response: [staff contract](../specs/supplier-staff-management/contracts/supplier-staff-api.md).

## Xem trường đã liên kết và hợp đồng phía nhà cung cấp (`supplier-school`)

Module `supplier-school` cung cấp năm endpoint GET chỉ đọc dưới `/api/supplier-schools`. Yêu cầu tài khoản `ACTIVE`, vai trò `INGREDIENT_SUPPLIER_ADMIN`, tổ chức `SUPPLIER` có `supplierId` hợp lệ (không có `schoolId`/`communeFoodSafetyUnitId`) và ít nhất một quyền hiệu lực `supplier_relationship.view` hoặc `supplier_relationship.manage` (`OR`, trừ denial trong tổ chức hiện tại). `INGREDIENT_SUPPLIER_STAFF`, `SYSTEM_ADMIN` (không bypass), `SCHOOL` và `AUTHORITY` bị chặn `403` kể cả khi được gán các quyền trên. Scope `{ supplierId }` luôn lấy từ principal nạp lại mỗi request, không nhận từ query/body và không cache phân quyền.

| Method | Path                                                                          | Hành vi và kiểm tra phạm vi                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/supplier-schools`                                                       | Mỗi trường một mục (`id` UUID + `code`), đại diện `ACTIVE`/`SUSPENDED` trước `UNLINKED`, `linkedAt DESC`/`id ASC`; phân trang trước `page`/`limit` 1–100    |
| GET    | `/api/supplier-schools/:schoolId`                                             | Chi tiết trường (gồm trường `INACTIVE`) và quan hệ đại diện (`ACTIVE`/`SUSPENDED`/`UNLINKED`), query rỗng; không nhúng hợp đồng                             |
| GET    | `/api/supplier-schools/:schoolId/contracts`                                   | Yêu cầu cặp có quan hệ (`404` nếu không); danh sách `ACTIVE`/`CLOSED` mọi đợt (`createdAt DESC`, `id ASC`), giữ ngày hiệu lực tương lai/hết hạn             |
| GET    | `/api/supplier-schools/:schoolId/contracts/:contractId`                       | Chi tiết hợp đồng `ACTIVE`/`CLOSED` đúng cặp `schoolId` + `supplierId` + `contractId`, query rỗng; gồm nguyên liệu và metadata `SIGNED_CONTRACT`/`APPENDIX` |
| GET    | `/api/supplier-schools/:schoolId/contracts/:contractId/documents/:documentId` | Mở (`disposition=inline` mặc định) hoặc tải (`attachment`) bytes gốc `SIGNED_CONTRACT`/`APPENDIX` của hợp đồng `ACTIVE`/`CLOSED` đúng cặp                   |

Bản nháp `DRAFT`, tài liệu `COMPLIANCE`, trường chỉ có nháp hoặc tài nguyên thuộc cặp/nhà cung cấp khác đều trả `404` thống nhất (`Không tìm thấy dữ liệu trong phạm vi được phép`), không làm lộ tên tệp hay metadata. Endpoint binary trả `Content-Type` (`application/pdf`, `image/png`, `image/jpeg`), `Content-Length`, `Content-Disposition` UTF-8 RFC 5987, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` và `Cache-Control: private, no-store`; lỗi đọc hoặc bytes hỏng trả JSON `503` trước khi gửi headers thành công. Các endpoint JSON cũng đặt `Cache-Control: private, no-store`.

Catalog chỉ thêm default grant `supplier_relationship.view` cho role `INGREDIENT_SUPPLIER_ADMIN` khởi tạo mới. Các hệ thống đã tồn tại role này không được `auth:bootstrap` tự cấp lại để bảo toàn cấu hình hiện hữu; operator phải cấp quyền theo quy trình quản lý role trong [quickstart](../specs/supplier-linked-schools/quickstart.md). Hợp đồng API đầy đủ: [supplier-schools-api.md](../specs/supplier-linked-schools/contracts/supplier-schools-api.md).

## Phản hồi khiếu nại chất lượng nguyên liệu (`ingredient-quality-feedback`)

Module `ingredient-quality-feedback` dùng phân quyền động theo DB trên từng request (tài khoản `ACTIVE`, membership tổ chức duy nhất, `Permission.isActive`, `RolePermission` trừ `UserPermissionDenial`, không cache phân quyền và không SYSTEM bypass). Quyền mặc định cho `INGREDIENT_SUPPLIER_ADMIN` và `INGREDIENT_SUPPLIER_STAFF` (`view_details`, `respond`) đã có trong `src/constants/permission-catalog.ts`. Từ PR3 ([specs/ingredient-feedback-submission](../specs/ingredient-feedback-submission/spec.md), Q11) catalog mặc định cấp `submit`, `view_own`, `view_details` cho `SCHOOL_MANAGEMENT_BOARD` (xem toàn trường) và chỉ `submit`, `view_own` cho `SCHOOL_KITCHEN_STAFF`, `SCHOOL_NUTRITION_OFFICER` (chỉ đơn mình gửi). `auth:bootstrap` không sửa quyền của role đã tồn tại; trên DB đang chạy operator chỉnh qua API quản trị quyền.

| Method | Path                                                    | Nhóm được gọi                | Quyền và phạm vi                                                                                                                                                                                               |
| ------ | ------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/ingredient-quality-feedback`                      | Người gửi (`SCHOOL`)         | `ingredient_quality_feedback.submit` + `view_own`/`view_details`; trường `ACTIVE`; chuyến giao của trường ở `RECEIVED`/`REJECTED` (khác trường `404`, sai trạng thái `409`); lô phải thuộc chuyến giao (`400`) |
| GET    | `/api/ingredient-quality-feedback`                      | `SUPPLIER` (`ADMIN`/`STAFF`) | `ingredient_quality_feedback.view_details` (`view_own` đơn lẻ bị `403`); phạm vi `Delivery.supplierId`                                                                                                         |
| GET    | `/api/ingredient-quality-feedback`                      | `SCHOOL`, `SYSTEM`           | `view_own` (thêm `senderUserId = actor.id`) hoặc `view_details` (toàn trường); `SYSTEM` cần quyền được gán                                                                                                     |
| GET    | `/api/ingredient-quality-feedback/:feedbackId`          | `SUPPLIER` (`ADMIN`/`STAFF`) | `ingredient_quality_feedback.view_details`; phạm vi `Delivery.supplierId`; hỗ trợ lịch sử sau `SUSPENDED`/`UNLINKED`                                                                                           |
| GET    | `/api/ingredient-quality-feedback/:feedbackId`          | `SCHOOL` (`FR-011`)          | `view_details`: toàn trường (`Delivery.schoolId`); chỉ `view_own`: đúng `senderUserId`; `SYSTEM`/`AUTHORITY` bị `403`                                                                                          |
| POST   | `/api/ingredient-quality-feedback/:feedbackId/accept`   | `SUPPLIER` (`ADMIN`/`STAFF`) | Bắt buộc **đồng thời** `ingredient_quality_feedback.view_details` **và** `ingredient_quality_feedback.respond`; phạm vi `Delivery.supplierId`                                                                  |
| POST   | `/api/ingredient-quality-feedback/:feedbackId/resolve`  | `SUPPLIER` (`ADMIN`/`STAFF`) | Như `accept`; body `{content}`, chỉ từ `IN_PROGRESS`/`REOPENED`                                                                                                                                                |
| POST   | `/api/ingredient-quality-feedback/:feedbackId/comments` | `SUPPLIER` hoặc người gửi    | NCC: như `accept`, sau khi đã nhận đơn; trường: `ingredient_quality_feedback.submit` và là người gửi                                                                                                           |
| POST   | `/api/ingredient-quality-feedback/:feedbackId/satisfy`  | Người gửi (`SCHOOL`)         | `ingredient_quality_feedback.submit`; chỉ người gửi, trong 48h sau lần giải quyết gần nhất                                                                                                                     |
| POST   | `/api/ingredient-quality-feedback/:feedbackId/reopen`   | Người gửi (`SCHOOL`)         | Như `satisfy`; body `{reason?}`                                                                                                                                                                                |

## Cấu hình nhóm duyệt kiểm nhận nguyên liệu theo trường (delivery-inspection-tiers)

Module `organization` và `delivery` hỗ trợ cấu hình phân nhóm duyệt linh hoạt theo từng trường thay vì hardcode 4 bộ phận cố định:

- Nhóm 1 (`PRIMARY`): Đúng 1 vai trò (mặc định Bếp trưởng `SCHOOL_KITCHEN_STAFF`). Duy nhất vai trò này được bấm "Xác nhận xe đã đến" (`POST /api/deliveries/:id/arrival`), đồng thời bắt buộc phải duyệt kiểm nhận.
- Nhóm 2 (`REQUIRED`): Bắt buộc phải duyệt chấp thuận (`ACCEPTED`) thì đợt giao mới hoàn tất chuyển sang `RECEIVED` (mặc định Kho `INGREDIENT_MANAGEMENT_DEPARTMENT` và Dinh dưỡng `SCHOOL_NUTRITION_OFFICER`).
- Nhóm 3 (`OPTIONAL`): Ban Đại diện Phụ huynh (`PARENTS_COMMITTEE`) luôn cố định ở nhóm này (chỉ đọc trên UI, không cho BGH sửa, không lưu vào DB cấu hình trường). Ý kiến từ chối (`REJECTED`) của nhóm OPTIONAL chỉ mang tính chất tham khảo, không làm chuyển đợt giao sang `REJECTED` và không tính vào giới hạn `cap3`.

| Method | Path                                        | Vai trò và quyền                                                                                                                                                |
| ------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/schools/me/delivery-inspection-roles` | `school_delivery_inspection.manage`; vai trò `SCHOOL_MANAGEMENT_BOARD`, tổ chức `SCHOOL`. Trả danh sách 4 vai trò kèm `tier`, nhãn tiếng Việt và cờ `editable`. |
| PUT    | `/api/schools/me/delivery-inspection-roles` | `school_delivery_inspection.manage`; vai trò `SCHOOL_MANAGEMENT_BOARD`, tổ chức `SCHOOL`. Body gồm 3 vai trò (`PARENTS_COMMITTEE` bị loại trừ), đúng 1 PRIMARY. |
| POST   | `/api/deliveries/:id/arrival`               | `delivery.inspect`; chỉ tài khoản có vai trò `PRIMARY` theo snapshot của đợt giao (hoặc cấu hình trường) mới được xác nhận xe đến.                              |
| POST   | `/api/deliveries/:id/inspections`           | `delivery.inspect`; tài khoản có vai trò thuộc đợt giao. Sau khi đợt giao đã `RECEIVED`, khóa duyệt trả `409 Conflict`.                                         |

Khi xe đến, snapshot cấu hình nhóm duyệt được lưu bất biến vào bảng `delivery_inspection_roles`. Mọi cập nhật cấu hình của Ban Giám hiệu sau thời điểm đó chỉ áp dụng cho các đợt xe đến mới.

Các thao tác ghi phía NCC (`accept`, `resolve`, `comments`) thực hiện trong transaction `Serializable`: đọc lại actor trực tiếp qua `identitySelect` -> khóa `school -> supplier -> actor user -> actor role (FOR SHARE) -> permission rows (view_details/respond FOR SHARE theo id) -> delivery -> complaint` -> kiểm lại actor (cùng `roleId`/`role`/`orgType`/`supplierId` và đủ cả hai quyền), trạng thái nguồn của ticket và update có điều kiện (thua khi chạy đồng thời trả `409`). Thu hồi quyền, khóa user hoặc thay role grant hoàn tất trước điểm khóa khiến transaction retry đọc snapshot mới và từ chối `403`. `SCHOOL`, `SYSTEM`, `AUTHORITY` và supplier thiếu một trong hai quyền đều nhận `403` trên `accept`/`resolve`; mọi UUID ngoài phạm vi/không tồn tại trả cùng `404`. API HTTP tạo phản ánh nguyên liệu phía trường thuộc PR sau của [specs/complaint-supertype](../specs/complaint-supertype/spec.md). Route `POST /:feedbackId/response` đã bị bỏ.

Phân bổ theo nguyên liệu dùng GET /api/meal-allocations?mealType (meal_allocation.view) tự lập phương án cho bữa chưa phân bổ và PUT /api/meal-allocations (meal_allocation.update, thêm create khi cần) để lưu. Không có endpoint tính riêng. Phạm vi trường từ principal, bữa từ validation, áp dụng yêu cầu revision/planId. Chi tiết tại specs/meal-allocation-materials/contracts/material-plan.md.

## Danh mục đơn vị tính

GET /api/measurement-units và GET /:id là danh mục toàn hệ thống: yêu cầu authenticate, không yêu cầu role hoặc quyền danh sách riêng theo yêu cầu đã duyệt. POST và PATCH /:id chỉ SYSTEM_ADMIN thuộc SYSTEM và có measurement_unit.manage; actor/role/quyền được kiểm tra lại trong Serializable transaction. Không có DELETE. Chi tiết: specs/measurement-units/contracts.md.

Bootstrap chọn riêng quyền: npm run auth:bootstrap -- --azure --permission-code=measurement_unit.manage. Chế độ này không tạo role, không thêm permission ngoài lựa chọn, không bật lại permission đã tắt và không thay grants các role tổ chức hiện hữu. Chỉ chạy remote khi đã được duyệt riêng.
