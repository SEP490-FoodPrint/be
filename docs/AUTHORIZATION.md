# Phân quyền FoodPrint

## Chính sách đã chốt

Mỗi tài khoản có một role. Quyền hiệu lực là permission active được gán cho role trừ denial của tài khoản trong tổ chức hiện tại. JWT chỉ xác định tài khoản bằng UUID sub; backend đọc lại user ACTIVE, role, tổ chức và quyền mỗi request. Không cache quyền và không có System Admin bypass.

System Admin được thêm permission và sửa bộ quyền mọi role khác, áp dụng toàn hệ thống cho tài khoản mang role đó. Role SYSTEM_ADMIN chỉ đọc qua API; mọi yêu cầu sửa trả 403. Quyền gán mới vẫn chịu ràng buộc phạm vi tài nguyên, không tự cấp quyền truy cập khác tổ chức.

Mỗi trường có tối đa một SCHOOL_ADMINISTRATION, mỗi supplier có tối đa một INGREDIENT_SUPPLIER_ADMIN, tính cả tài khoản inactive. Các role nhân viên có thể có nhiều tài khoản. ATTP xã dùng COMMUNE_FOOD_SAFETY_OFFICER, không có chức năng quản trị quyền, kể cả khi được gán permission quản trị.

Admin tổ chức chỉ bật/tắt quyền role đã có cho tài khoản ACTIVE cùng tổ chức. Tắt tạo denial, bật lại xóa denial; không có bảng lịch sử. Nếu role mất một permission, admin tổ chức không thể cấp lại ngoài role. Denial riêng không bị xóa khi System Admin sửa bộ quyền role.

## HTTP API

Dùng envelope hiện có. Thiếu/sai token: 401; không ACTIVE/thiếu quyền: 403; tài khoản đích ngoài phạm vi: 404; DTO sai: 400; permission trùng: 409; DB không sẵn sàng: 503.

| API                                                        | Điều kiện/nội dung                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/auth/login                                       | Body identifier (username/email), password (1–72 byte UTF-8); trả accessToken, tokenType và user; không phân biệt lỗi sai user/password |
| GET /api/auth/me                                           | Hồ sơ tin cậy và phạm vi của tài khoản hiện tại                                                                                         |
| GET /api/auth/me/permissions                               | Danh sách mã quyền hiệu lực hiện tại                                                                                                    |
| GET /api/auth/roles                                        | System, role.view; giữ nguyên đường dẫn cũ                                                                                              |
| GET /api/permissions                                       | System, permission.view; page/limit                                                                                                     |
| POST /api/permissions                                      | System, permission.create; body code, name, module, action, description tùy chọn                                                        |
| GET /api/roles/:roleId/permissions                         | System, role_permission.manage; SYSTEM_ADMIN có editable=false                                                                          |
| PUT /api/roles/:roleId/permissions                         | System, role_permission.manage; body permissionIds là mảng UUID không trùng, chỉ permission active; role SYSTEM_ADMIN luôn bị chặn      |
| GET /api/users/:userId/permissions                         | System có user.manage hoặc admin cùng tổ chức có quyền quản lý tương ứng                                                                |
| PUT /api/users/:userId/permission-denials/:permissionId    | Tắt; school admin có school_user.manage hoặc supplier admin có supplier_staff.manage                                                    |
| DELETE /api/users/:userId/permission-denials/:permissionId | Bật lại quyền kế thừa; cùng điều kiện và phạm vi như PUT                                                                                |

Các thao tác ghi xác minh lại actor và target trong transaction Serializable, có retry giới hạn cho serialization conflict. PUT/DELETE denial lặp lại an toàn; partial unique index và transaction ngăn tạo bản ghi trùng. Thêm permission vào catalog chưa tự tạo chức năng/API: endpoint phải kiểm tra mã quyền đó.

JWT dùng HS256, issuer foodprint, audience foodprint-api; JWT_SECRET là bắt buộc. Client cần đăng nhập lại nếu token cũ thiếu UUID sub hoặc sai issuer/audience. Không đưa role/permissions vào JWT làm nguồn quyết định quyền. Token vẫn có hạn theo JWT_EXPIRES_IN; mỗi request còn kiểm tra trạng thái tài khoản trong DB. Chưa thêm refresh token, đăng ký hoặc User CRUD trong phạm vi này.

## Ma trận API danh sách

Mọi dòng đều yêu cầu một trong các permission liệt kê. SYSTEM có phạm vi toàn hệ thống **khi được gán quyền**, còn tổ chức khác theo quan hệ sở hữu trong resource-access.ts. Phạm vi dưới đây là org-level, không tự suy diễn lớp được giao cho giáo viên.

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
| `feedback`                    | `meal_complaint.view`                                                              | SCHOOL                       |
| `inspection`                  | `food_safety_incident.view`                                                        | SCHOOL, AUTHORITY            |
| `supplier`                    | `supplier.view`, `supplier.manage`                                                 | SUPPLIER, SCHOOL             |
| `authority`                   | `authority.view`, `food_safety_report.view`                                        | AUTHORITY                    |
| `class`                       | `class.view`                                                                       | SCHOOL                       |
| `source-facility`             | `source_facility.manage`                                                           | SUPPLIER                     |
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
