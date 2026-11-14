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

| API                                                        | Điều kiện/nội dung                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/auth/signup                                      | Tạo user UNVERIFIED, chưa tạo hồ sơ PENDING; Resend gửi mã sau commit; JSON báo verificationEmailSent, không cấp token                      |
| POST /api/auth/email-verification/request                  | Body email; gửi/gửi lại mã 6 số qua Resend; giới hạn theo email/IP, thông báo chung                                                         |
| POST /api/auth/email-verification/verify                   | Body email/code; cập nhật emailVerifiedAt, giữ UNVERIFIED; không cấp cookie hoặc quyền                                                      |
| POST /api/auth/login                                       | Body identifier/password; cho phép ACTIVE hợp lệ hoặc UNVERIFIED đã xác minh email; đặt cookie HttpOnly, JSON trả user và expiresIn         |
| POST /api/auth/refresh                                     | Đọc refresh cookie, kiểm tra hash/TTL và trạng thái user từ DB, đổi refresh token; không tự kích hoạt tài khoản                             |
| POST /api/auth/logout                                      | Thu hồi phiên Redis và xóa cookie                                                                                                           |
| GET /api/auth/me                                           | Thông tin tài khoản, status/onboardingRequired và trạng thái hồ sơ; UNVERIFIED không có permissions                                         |
| PATCH /api/auth/me                                         | Sửa fullName/phone của chính tài khoản ACTIVE hoặc UNVERIFIED đã xác minh email; không cần user.manage, không sửa email/role/status/tổ chức |
| GET /api/auth/me/permissions                               | Danh sách mã quyền hiệu lực khi ACTIVE; UNVERIFIED nhận mảng rỗng                                                                           |
| GET /api/auth/roles                                        | System, role.view; giữ nguyên đường dẫn cũ                                                                                                  |
| GET /api/permissions                                       | System, permission.view; page/limit                                                                                                         |
| POST /api/permissions                                      | System, permission.create; body code, name, module, action, description tùy chọn                                                            |
| GET /api/roles/:roleId/permissions                         | System, role_permission.manage; SYSTEM_ADMIN có editable=false                                                                              |
| PUT /api/roles/:roleId/permissions                         | System, role_permission.manage; body permissionIds là mảng UUID không trùng, chỉ permission active; role SYSTEM_ADMIN luôn bị chặn          |
| GET /api/users/:userId/permissions                         | System có user.manage hoặc admin cùng tổ chức có quyền quản lý tương ứng                                                                    |
| PUT /api/users/:userId/permission-denials/:permissionId    | Tắt; school admin có school_user.manage hoặc supplier admin có supplier_staff.manage                                                        |
| DELETE /api/users/:userId/permission-denials/:permissionId | Bật lại quyền kế thừa; cùng điều kiện và phạm vi như PUT                                                                                    |
| GET /api/schools/:schoolId/accounts                        | SCHOOL (school_user.manage / user.manage), xem danh sách tài khoản nhân viên trường (phân trang page/limit)                                 |
| GET /api/schools/:schoolId/accounts/:userId                | SCHOOL (school_user.manage), xem thông tin chi tiết một tài khoản nhân viên trường                                                          |
| POST /api/schools/:schoolId/accounts                       | SCHOOL (school_user.manage), tạo tài khoản nhân sự mới cho trường (Bếp, Y tế, GVCN...)                                                      |
| PUT /api/schools/:schoolId/accounts/:userId                | SCHOOL (school_user.manage), cập nhật họ tên, SĐT, vai trò nhân sự                                                                          |
| PATCH /api/schools/:schoolId/accounts/:userId/status       | SCHOOL (school_user.manage), khóa (LOCKED) hoặc mở khóa (ACTIVE) tài khoản nhân sự                                                          |

Các thao tác ghi xác minh lại actor và target trong transaction Serializable, có retry giới hạn cho serialization conflict. PUT/DELETE denial lặp lại an toàn; partial unique index và transaction ngăn tạo bản ghi trùng. Thêm permission vào catalog chưa tự tạo chức năng/API: endpoint phải kiểm tra mã quyền đó.

JWT access dùng HS256, issuer foodprint, audience foodprint-api; JWT_SECRET là bắt buộc. Token mang UUID sub và sid của phiên Redis còn sống; token cũ thiếu sid cần đăng nhập lại. Không đưa role/permissions vào JWT làm nguồn quyết định quyền. Mỗi request kiểm tra phiên Redis rồi tải trạng thái tài khoản và quyền hiện tại từ DB. Redis chứa metadata phiên và hash refresh token, không cache quyền. Xem [cookie, CSRF, TTL, rotation và hợp đồng đăng ký](AUTH_SESSIONS.md). [API hồ sơ theo Figma](ONBOARDING.md) gồm nộp/xem hồ sơ, tài liệu riêng và System Admin duyệt/từ chối. Sau khi nộp vẫn UNVERIFIED; chỉ duyệt thành công mới tạo tổ chức và chuyển ACTIVE. Chưa bổ sung User CRUD tổng quát.

[Xác minh email](EMAIL_VERIFICATION.md) dùng challenge Redis riêng, HMAC-SHA256, hạn 10 phút, tối đa 5 lần thử, tiêu thụ mã nguyên tử. Đây là bằng chứng sở hữu email, không phải trạng thái ACTIVE hay permission. UNVERIFIED chưa xác minh email bị chặn login/refresh/hồ sơ; tài khoản ACTIVE cũ không bị khóa tự động do emailVerifiedAt=null.

Xét duyệt yêu cầu SYSTEM_ADMIN cùng permission được gán: registration.view để xem chi tiết, registration.approve để duyệt, registration.reject để từ chối. Không dùng quyền xem để thay quyền ghi. Các thao tác kiểm tra lại actor/target trong transaction; xung đột serialization PostgreSQL qua Prisma P2034 hoặc P2010/SQLSTATE 40001 được retry giới hạn. Catalog/bootstrap được cập nhật trong code; database đang dùng cần operator bootstrap riêng theo chính sách, không tự thay đổi khi khởi động hay CD.

## Ma trận API danh sách

Cooking Batch Phương án A bổ sung GET `/api/cooking-batches/:id` với `cooking_batch.view`, giữ scope đọc như danh sách; POST `/api/cooking-batches` dùng `cooking_batch.create`, POST `/:id/confirm` dùng `cooking_batch.confirm`, POST `/:id/complete` dùng `cooking_batch.complete`. Thao tác ghi yêu cầu SCHOOL có schoolId tin cậy, xác minh lại actor/quyền trong transaction; SYSTEM không có bypass. Không thêm role/grant/permission. Plan chỉ nhận menuDayId/dishId/mealType; confirm/complete không nhận số suất hoặc lượng nguyên liệu.

Mọi dòng đều yêu cầu một trong các permission liệt kê. SYSTEM có phạm vi toàn hệ thống **khi được gán quyền**, trừ các chức năng giới hạn vai trò được nêu riêng, bao gồm quản lý cơ sở cung cấp chỉ dành quản trị nhà cung cấp. Tổ chức khác theo quan hệ sở hữu trong resource-access.ts. Phạm vi dưới đây là org-level, không tự suy diễn lớp được giao cho giáo viên.

| Module                        | Permission (OR)                                                                    | Tổ chức ngoài SYSTEM được mở |
| ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------- |
| `auth`                        | `role.view`                                                                        | Không                        |
| `user`                        | `user.manage`, `school_user.manage`, `supplier_staff.manage`                       | SCHOOL, SUPPLIER             |
| `organization`                | `school.manage`                                                                    | SCHOOL                       |
| `ingredient`                  | `ingredient.view`, `ingredient.manage`                                             | SCHOOL, SUPPLIER             |
| `menu`                        | `menu.view`                                                                        | SCHOOL                       |
| `supply-order`                | `supply_request.view`                                                              | SCHOOL, SUPPLIER             |
| `warehouse`                   | `inventory.view`                                                                   | SCHOOL, SUPPLIER             |
| `kitchen`                     | `cooking_batch.view`                                                               | SCHOOL                       |
| `meal-attendance`             | `daily_meal_portion.view`                                                          | SCHOOL                       |
| `feedback`                    | `meal_complaint.view`                                                              | SYSTEM, SCHOOL               |
| `inspection`                  | `food_safety_incident.view`                                                        | SCHOOL, AUTHORITY            |
| `supplier`                    | `supplier.view`, `supplier.manage`                                                 | SUPPLIER, SCHOOL             |
| `authority`                   | `authority.view`, `food_safety_report.view`                                        | AUTHORITY                    |
| `class`                       | `class.view`                                                                       | SCHOOL                       |
| `source-facility`             | `source_facility.manage`                                                           | SUPPLIER (chỉ admin)         |
| `supplier-certification`      | `supplier_certification.view`                                                      | SUPPLIER                     |
| `registration`                | `registration.view`                                                                | Không                        |
| `school-supplier`             | `supplier_relationship.view`, `supplier_relationship.manage`                       | SCHOOL, SUPPLIER             |
| `ingredient-entry`            | `ingredient.view`, `ingredient.manage`                                             | SCHOOL                       |
| `allergy`                     | `class_allergy.view`                                                               | SCHOOL                       |
| `delivery`                    | `delivery.view`, `delivery.manage`, `delivery.receive`                             | SCHOOL, SUPPLIER             |
| `dish`                        | `menu.view`                                                                        | SCHOOL                       |
| `inventory`                   | `inventory.view`                                                                   | SCHOOL, SUPPLIER             |
| `retained-sample`             | `retained_sample.view`                                                             | SCHOOL                       |
| `meal-allocation`             | `meal_allocation.view`                                                             | SCHOOL                       |
| `ingredient-quality-feedback` | `ingredient_quality_feedback.view_own`, `ingredient_quality_feedback.view_details` | SCHOOL, SUPPLIER             |
| `reporting`                   | `food_safety_report.view`                                                          | SCHOOL, AUTHORITY            |
| `food-analysis`               | `food_analysis_result.view`                                                        | SCHOOL, AUTHORITY            |
| `school-alert`                | `school_alert.view`                                                                | SCHOOL                       |
| `menu-review`                 | `menu.view`, `menu.review`, `menu.approve`                                         | SCHOOL                       |
| `traceability`                | `traceability.view`                                                                | SCHOOL, SUPPLIER, AUTHORITY  |

School xem supplier qua quan hệ ACTIVE/SUSPENDED; ingredient qua IngredientEntry của trường. Supplier xem tài nguyên supplier-owned hoặc delivery của supplier khi có permission phù hợp. ATTP xã chỉ thấy incident/report chuyển tới đơn vị mình; traceability chỉ mở phần liên quan trực tiếp. Với ingredient_quality_feedback.view_own, thêm điều kiện submittedByUserId; view_details vẫn giới hạn tổ chức. Các API cũ giữ phân trang, safe select và serialization Date/Decimal/BigInt.

- `GET /api/meal-complaints/meal-options` và `POST /api/meal-complaints` yêu cầu `meal_complaint.submit` và vai trò `HOMEROOM_TEACHER` hoặc `PARENTS_COMMITTEE`. Trường, ngày ăn và phạm vi lớp do server xác định.
- `meal_complaint.view` cho phép người gửi đọc đơn của chính mình trong trường và cho phép Ban Giám hiệu đọc đơn của trường. `meal_complaint.respond` dành cho Ban Giám hiệu. Migration spec 019 bổ sung quyền đọc đang hoạt động cho role `PARENTS_COMMITTEE` đã tồn tại và giữ các thiết lập thu hồi quyền theo tài khoản.

## API phân bổ suất ăn hôm nay

- `GET /api/meal-allocations` yêu cầu `meal_allocation.view` trong phạm vi trường. Trả trạng thái nấu, lưu mẫu, dữ liệu lô và phiên bản phân bổ.
- `PUT /api/meal-allocations` yêu cầu `meal_allocation.update`, và `meal_allocation.create` khi tạo hồ sơ lớp. BE kiểm lại điều kiện của cả ngày và ghi nguyên tử.
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

| Method | Endpoint                                       | Kết quả                                                  |
| ------ | ---------------------------------------------- | -------------------------------------------------------- |
| GET    | /api/ingredients/management                    | Nguyên liệu thuộc supplier hiện tại, gồm ACTIVE/INACTIVE |
| GET    | /api/ingredients/management/categories         | Danh mục dùng chung chỉ đọc                              |
| GET    | /api/ingredients/management/:ingredientId      | Chi tiết thuộc sở hữu                                    |
| POST   | /api/ingredients/management                    | Tạo nguyên liệu ACTIVE, tự gắn supplier                  |
| PATCH  | /api/ingredients/management/:ingredientId      | Sửa trường editable, giữ trạng thái                      |
| POST   | /api/ingredients/management/:ingredientId/hide | Chuyển INACTIVE; gọi lại thành công không đổi timestamp  |

Danh sách chỉ nhận page/limit, mặc định 1/20, limit tối đa 100, envelope items/pagination.hasNext hiện hành. Scope từ principal, không từ supplierId do client gửi. Target ngoài sở hữu và không tồn tại cùng 404. Trùng tên trong cùng supplier kể cả đang ẩn trả 409. Quyền đọc GET `/api/ingredients` hiện có giữ nguyên, gồm staff được cấp quyền đọc hợp lệ.

Input tạo/sửa chỉ gồm name/defaultUnit/description/categoryId/coverImage/imageDescription; tạo cần name và defaultUnit. PATCH bỏ qua giữ nguyên, null xóa trường nullable, [] xóa danh sách ảnh. coverImage tối đa một tham chiếu; imageDescription nhiều tham chiếu theo thứ tự. Chấp nhận URL HTTP/HTTPS không credentials hoặc đường dẫn bắt đầu /, tối đa 2048 ký tự. categoryId nullable tham chiếu danh mục có sẵn; chưa có API quản trị danh mục. Chi tiết input/output tại [contract](../specs/008-supplier-ingredient-management/contracts/ingredient-management.md).

Hai API `POST /api/ingredients/management/upload-image` và `POST /api/ingredients/management/upload-images` nhận multipart lần lượt một ảnh `image` hoặc từ một đến năm ảnh `images` (JPEG/PNG/WebP, tối đa 5 MiB mỗi ảnh). API dùng cùng quyền quản trị nguyên liệu; upload trước khi tạo/sửa và trả URL để gửi trong body JSON riêng. Single trả 201; batch trả 200 và kết quả thành công/thất bại cho từng tệp theo thứ tự. Chi tiết tại [contract upload](../specs/ingredient-image-upload/contracts/ingredient-upload-api.md).

Ẩn không xóa dữ liệu hoặc thay đổi hồ sơ đã có. Lựa chọn nguyên liệu mới và supplier discovery chỉ dùng nguyên liệu ACTIVE; menu/hợp đồng/lịch sử kho vẫn đọc được liên kết cũ. Các phản hồi legacy giữ category dạng tên/null suy ra từ quan hệ, không giữ thêm cột category trong DB.

## Kiểm tra từng đợt giao nguyên liệu

Màn dùng chung cho `SCHOOL_NUTRITION_OFFICER`, `SCHOOL_KITCHEN_STAFF`, `INGREDIENT_MANAGEMENT_DEPARTMENT`, `PARENTS_COMMITTEE`. Ngoài role hợp lệ, cần quyền hiệu lực trong trường hiện tại; không dùng role/school/user do client gửi.

| Method | Endpoint                         | Quyền                                 |
| ------ | -------------------------------- | ------------------------------------- |
| GET    | `/api/deliveries/inspections`    | `delivery.view`                       |
| GET    | `/api/deliveries/:id/inspection` | `delivery.view`                       |
| POST   | `/api/deliveries/:id/inspection` | `delivery.inspect` và `delivery.view` |

Danh sách nhận `page`, `limit`, `search`, `status`, `period` (`ALL`, `today`, `week`); tìm/lọc/phân trang và thống kê cùng phạm vi tại BE. Ngày/tuần dùng múi giờ Việt Nam. GET `/api/deliveries` cũ giữ nguyên.

POST chỉ nhận `decision` (`APPROVE`/`REJECT`) và `reason`; từ chối bắt buộc có lý do. Một quyết định bất biến cho mỗi role trên mỗi Delivery. Cùng actor gửi lại đúng nội dung không tạo thêm bản ghi; đổi nội dung hoặc người khác ký cho role đã ghi trả 409. Mỗi lần giao mới cần kiểm tra mới, không dùng lại chữ ký đợt trước.

Chỉ kiểm tra khi `ARRIVED`/`PENDING_APPROVAL`. Đủ bốn bên đồng ý mới chuyển `RECEIVED`, mở các lot hợp lệ và ghi đúng một `RECEIPT` mỗi lot trong cùng transaction. Không nhận vượt lượng yêu cầu, sai trường/Supplier/đơn, sai tổng lot/đơn vị/ngày hoặc lot đã có lịch sử kho.

Giới hạn giao lại tính chung theo SupplyRequest: số Delivery có ít nhất một quyết định REJECT. Lần từ chối thứ ba hủy SupplyRequest và các đợt còn chờ, chặn nhận tiếp; giữ nguyên đợt RECEIVED và kho/lịch sử đã ghi. GET/POST trả `redeliveryRequiredCount`, `redeliveryLimit`, `cancellationNotice`, `currentRole`, `requiredRoles`, `canInspect`; thông báo hủy hiển thị bền vững trên màn chung. Việc lập lịch/tạo chuyến giao lại phía Supplier nằm ngoài màn kiểm tra này.

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

| Endpoint                               | Quyền và phạm vi                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/supply-requests`             | `supply_request.view`; SUPPLIER chỉ admin/staff hiện tại, chỉ đơn của nhà cung cấp ngoài DRAFT; SCHOOL/SYSTEM giữ scope và projection cũ.           |
| GET `/api/supply-requests/:id`         | `supply_request.view`; chỉ INGREDIENT_SUPPLIER_ADMIN/INGREDIENT_SUPPLIER_STAFF thuộc SUPPLIER, đúng supplierId và ngoài DRAFT.                      |
| POST `/api/supply-requests/:id/accept` | `supply_request.accept`; cùng hai role supplier, xác minh lại quyền/membership/trạng thái trong Serializable transaction. Không yêu cầu quyền view. |

Nhánh danh sách SUPPLIER hỗ trợ `status` trong SENT/ACCEPTED/IN_PROGRESS/COMPLETED/CANCELLED; mặc định cả năm trạng thái. Giữ page mặc định 1, limit mặc định 20/tối đa 100 và hasNext; thêm schoolName, requestedDeliveryDate và sentAt. SCHOOL/SYSTEM vẫn chỉ nhận page/limit, gửi status trả 400; trường vẫn xem được bản nháp của chính mình theo quyền. Không lấy supplierId/schoolId từ query để mở rộng scope.

Chi tiết trả đủ dòng kể cả nguyên liệu/entry đã ngừng hoạt động. Số lượng là chuỗi Decimal, đơn vị lấy từ dòng đơn, ngày giao YYYY-MM-DD, timestamp ISO và dữ liệu thiếu giữ null. Người nhận biểu diễn bằng acceptedByUserId, không trả hồ sơ tài khoản, email/phone hay contractSnapshot. Ngoài scope/không tồn tại/DRAFT đều 404 với detail/accept.

Nhận mới chỉ SENT -> ACCEPTED, ghi người/thời điểm cùng transaction. Supplier tạm dừng hoặc admin một bên DEACTIVATED ngăn nhận mới; school tạm dừng tạo đơn không ngăn nhận đơn đã gửi. ACCEPTED/IN_PROGRESS trả receipt bốn trường cũ sau kiểm tra quyền và scope, không ghi đè thông tin đầu tiên hoặc updatedAt, kể cả khi supplier đã tạm dừng. COMPLETED/CANCELLED trả 409. Quyền bị tắt cho từng người vẫn có hiệu lực, không bypass SYSTEM và không cache phân quyền.

Thiết kế và hợp đồng: [supplier-order-intake](../specs/supplier-order-intake/contracts/supply-requests.md). Không thêm schema hoặc quyền mới; kết quả kiểm chứng thực tế được ghi tại [quickstart](../specs/supplier-order-intake/quickstart.md).
