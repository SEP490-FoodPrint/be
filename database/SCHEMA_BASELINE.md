# Baseline thiết kế database và Prisma

## Nguồn chuẩn

Nguồn hiện tại: [FoodPrint_PostgreSQL_Database_v5.sql](FoodPrint_PostgreSQL_Database_v5.sql), **version v5.3.1 theo header SQL**. Đối chiếu ngày **28/10/2026** bằng PostgreSQL AST ngoại tuyến; không introspect database cũ hoặc thực thi file SQL.

- PostgreSQL yêu cầu theo SQL: **15+**; chưa xác minh server của database mới.
- Prisma CLI / Client: **7.10.1**, TypeScript/CommonJS.
- PostgreSQL schema: `foodprint`; SQL yêu cầu extensions `pgcrypto` và `citext`.
- SHA-256 nguồn đã đối chiếu: `c67e914c3cb38ae08c5064ff914b7c0f66de685ba661f73ce64cc222086ad31d`.
- File `_v5_review.sql` trước đây không còn là nguồn hiện tại.

| Thành phần trong SQL hiện tại               | Số lượng                    |
| ------------------------------------------- | --------------------------- |
| Bảng / cột / enum                           | 41 / 404 / 27               |
| Khóa chính / khóa ngoại / unique constraint | 41 / 98 / 27                |
| Index khai báo bằng CREATE INDEX            | 52                          |
| Index có điều kiện                          | 8: 5 unique, 3 thông thường |
| CHECK constraint                            | 40                          |
| Role seed                                   | 11 mã actor                 |
| Functions / triggers / DO blocks            | 0 / 0 / 0                   |

Số liệu mô tả file thiết kế, không phải kết quả kiểm tra database đang chạy. Prisma models không tự triển khai SQL hoặc seed data.

## Những phần đã đồng bộ so với schema trước

- Thêm `CommuneFoodSafetyUnit` ánh xạ `commune_food_safety_units`, gồm thông tin và trạng thái của tổ chức cấp xã.
- Thêm `User.communeFoodSafetyUnitId` và quan hệ `communeFoodSafetyUnit`; SQL giới hạn mỗi user thuộc tối đa một trong ba nhóm tổ chức school/supplier/commune unit bằng CHECK constraint.
- Thêm `FoodSafetyReportForwarding.recipientCommuneFoodSafetyUnitId`, quan hệ `recipientCommuneFoodSafetyUnit` và index có điều kiện tương ứng.
- Thêm `RoleType.AUTHORITY`, giữ nguyên các giá trị enum còn lại.
- Loại models `MediaAsset`, `EmailDeliveryLog`, `IncidentInvestigationTeam` cùng các quan hệ ngược vì SQL mới đã bỏ ba bảng này. Không tự thêm các entity thay thế.
- Giữ tên field API của 96 cặp FK không đổi; hai FK mới và các cột mới dùng camelCase. `@map`/`@@map` giữ nguyên tên vật lý, mọi model/enum có `@@schema("foodprint")`.
- Đối chiếu native types, precision/scale, nullability, defaults, thứ tự composite keys, referential actions và index predicates. Quan hệ ghép `CookingBatch` → `MenuDayDish` vẫn gồm `menuDayId`, `dishId`, `mealType`.

## Timestamp và quy tắc nghiệp vụ

SQL v5.3.1 chủ động bỏ functions/triggers và giao business rules, lifecycle transitions, inventory posting, `updated_at` cho Backend Services/ORM.

- 28 cột `updated_at` dùng `@default(now()) @updatedAt`. Giá trị mặc định trong SQL được giữ nguyên; Prisma quản lý timestamp khi cập nhật qua Client. Đây là [hành vi ở tầng ORM](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#updatedat), không tạo trigger database.
- Ghi bằng raw SQL hoặc công cụ khác phải cập nhật `updated_at` rõ ràng. Không coi `DEFAULT now()` là cơ chế tự đổi timestamp khi UPDATE.
- CHECK constraints vẫn thuộc SQL, không được Prisma models biểu diễn đầy đủ. Cross-table validation, phân quyền actor, tổng số suất ăn, lifecycle và inventory posting cần triển khai tại service với transaction khi cần.
- Task đồng bộ schema này không triển khai các nghiệp vụ đó. Không dựa vào các trigger của thiết kế cũ để cho rằng database mới đã tự kiểm tra hoặc ghi nhận inventory.

## Partial indexes

Giữ `partialIndexes` và predicates từ SQL:

| Index                                        | Điều kiện                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `uq_source_facility_supplier_code`           | `facility_code IS NOT NULL`                                            |
| `uq_school_supplier_current`                 | `status IN ('ACTIVE', 'SUSPENDED')`                                    |
| `uq_inventory_initial_receipt_per_lot`       | `movement_type = 'RECEIPT'`                                            |
| `uq_inventory_usage_per_batch_lot`           | `movement_type = 'COOKING_USAGE' AND reference_type = 'COOKING_BATCH'` |
| `uq_traceability_anchor_tx_hash`             | `transaction_hash IS NOT NULL`                                         |
| `idx_users_supplier_id`                      | `supplier_id IS NOT NULL`                                              |
| `idx_users_commune_food_safety_unit_id`      | `commune_food_safety_unit_id IS NOT NULL`                              |
| `idx_food_safety_forwardings_recipient_unit` | `recipient_commune_food_safety_unit_id IS NOT NULL`                    |

Một lot có nhiều inventory transactions; `IngredientLot.inventoryTransactions` vẫn là danh sách. Partial uniqueness không phải unique toàn bảng và không được dùng để suy ra quan hệ một-một.

Phiên bản Client này có thể đưa các trường partial unique vào `WhereUniqueInput`. Dùng primary key thực cho `findUnique`, `update`, `delete`, `upsert`; truy vấn theo các trường chỉ unique khi thỏa điều kiện cần predicate đầy đủ và API đọc phù hợp.

## Role constants và phần mô tả cần review

`ROLES` hiện đồng bộ đủ 11 mã trong seed SQL; `ORG_TYPES` đồng bộ bốn giá trị của `role_type` (`SYSTEM`, `SCHOOL`, `SUPPLIER`, `AUTHORITY`). Đã cập nhật các mã chưa khớp:

| Thành phần                           | Mã trước đây     | Mã hiện tại theo SQL          |
| ------------------------------------ | ---------------- | ----------------------------- |
| Role quản trị trường                 | `SCHOOL_ADMIN`   | `SCHOOL_ADMINISTRATION`       |
| Role cán bộ an toàn thực phẩm cấp xã | `HEALTH_OFFICER` | `COMMUNE_FOOD_SAFETY_OFFICER` |
| Nhóm tổ chức                         | `GOVERNMENT`     | `AUTHORITY`                   |

Nhãn hiển thị của hai role đổi mã được cập nhật tương ứng; các nhãn còn lại được giữ nguyên. `ROLES.INGREDIENT_MANAGEMENT` vẫn có giá trị `INGREDIENT_MANAGEMENT_DEPARTMENT` khớp SQL, không tạo role phụ hoặc alias có mã trùng.

Middleware tiếp tục so sánh chính xác chuỗi và giữ nguyên phản hồi 401/403. JWT hoặc callers còn dùng các mã cũ sẽ không khớp allowlist mới; không tự chuyển chúng thành quyền mới. Chưa thêm API nghiệp vụ, thay đổi seed hoặc cập nhật dữ liệu database trong lần đồng bộ constants này.

Một số SQL comments chưa theo kịp DDL: comment `roles.type` chưa liệt kê `AUTHORITY`; comment của `food_safety_report_forwardings` nói recipient là bên ngoài dù bảng đã có FK recipient commune unit. Ánh xạ cấu trúc Prisma dựa trên DDL thực tế; file SQL đầu vào được giữ nguyên để người phụ trách thiết kế review các mô tả này.

## Kiểm tra và trạng thái triển khai

Đã đối chiếu cấu trúc bằng PostgreSQL AST và kiểm tra schema/Client. Các lệnh kiểm tra file/code:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run build
```

Các lệnh Prisma cần `DATABASE_URL` có cú pháp hợp lệ để tải config, dù validate/generate không truy vấn database. Kiểm tra ngoại tuyến có thể đặt một URL placeholder local cho riêng lệnh, không ghi `.env`:

```bash
DATABASE_URL='postgresql://schema_validation@127.0.0.1:1/foodprint_schema_validation?schema=foodprint' npm run prisma:validate
DATABASE_URL='postgresql://schema_validation@127.0.0.1:1/foodprint_schema_validation?schema=foodprint' npm run build
```

URL placeholder chỉ dùng CLI ngoại tuyến, không dùng với `dev`, `start` hoặc `db:check`. Khi kết nối thật, dùng URL `postgresql://`/`postgres://` tới database local đúng thiết kế; không dùng chuỗi JDBC hoặc kết quả SELECT 1 của database cũ để xác nhận models mới.

Chưa tạo, cập nhật hoặc kiểm tra models trên một database mới chạy thực tế trong task này. Không chạy SQL, DDL, migration, reset, db push, seed hoặc deployment. Việc đồng bộ file Prisma không cho phép chạy script CREATE-from-scratch vào database cũ có dữ liệu.

## Bổ sung UserPermissionDenial — chuẩn bị ngày 29/10/2026

[patches/001_user_permission_denials.sql](patches/001_user_permission_denials.sql) là SQL bổ sung cho model `UserPermissionDenial`, ánh xạ `foodprint.user_permission_denials`. Patch cần các bảng `users`, `permissions`, `schools`, `suppliers`, `commune_food_safety_units` đã có trong schema `foodprint`; phần permissions/role_permissions thuộc thiết kế RBAC v5.4, không nằm trong nguồn v5.3.1 thống kê phía trên.

- Patch tạo một bảng mới, ba partial unique index theo user/permission/tổ chức, hai index hỗ trợ và sáu khóa ngoại khớp model Prisma. Không sửa các bảng nghiệp vụ hiện hữu hoặc thêm seed.
- CHECK `chk_user_permission_denials_exactly_one_organization` bắt buộc `num_nonnulls(school_id, supplier_id, commune_food_safety_unit_id) = 1`: chấp nhận đúng một tổ chức, từ chối cả ba null hoặc nhiều tổ chức. Áp dụng cho cả INSERT và UPDATE.
- Thao tác nằm trong transaction, có giới hạn chờ lock và thời gian statement. Nếu bảng đích đã tồn tại, patch dừng; cần đối chiếu cấu trúc trước khi chuẩn bị SQL phù hợp, không xóa bảng hoặc dữ liệu để chạy lại.
- Đây là patch SQL độc lập, không tự thiết lập lịch sử Prisma Migrate. `prisma generate` và `db push` không bổ sung CHECK này; phải áp dụng bản SQL đã review trong bước triển khai được cho phép.
- Backend vẫn cần kiểm tra user và admin thuộc đúng tổ chức, permission thuộc role và permission đang hoạt động. CHECK này chỉ cưỡng chế số tổ chức trên từng dòng; không tự thực hiện các kiểm tra phân quyền đó.

**Trạng thái:** mới chuẩn bị file để commit/push và review, chưa thực thi patch lên Azure hoặc database local hiện hữu. Hai file SQL thiết kế gốc được giữ nguyên.
