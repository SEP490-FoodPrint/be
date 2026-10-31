# Baseline database và lịch sử migration

## Nguồn chuẩn

Lịch sử triển khai schema được quản lý tại `prisma/migrations/`, với provider PostgreSQL và Prisma CLI/Client theo lockfile hiện tại (**7.10.1**). `prisma/schema.prisma` mô tả trạng thái đích; các CHECK và SQL riêng của PostgreSQL nằm trong migration.

| Migration                                  | Nội dung                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `0_init`                                   | Baseline cấu trúc v5.4 đang có trên Azure, trước UserPermissionDenial                            |
| `20261029000100_user_permission_denials`   | Thêm bảng quyền bị tắt theo user/tổ chức, FK, partial unique index và CHECK đúng một tổ chức     |
| `20261029000200_single_organization_admin` | Thêm role_code được FK ghép kiểm tra, CHECK loại tổ chức và unique một admin mỗi school/supplier |

Baseline lấy phần DDL từ [FoodPrint_PostgreSQL_Database_v5_4_FINAL_with_MOCK_DATA.sql](FoodPrint_PostgreSQL_Database_v5_4_FINAL_with_MOCK_DATA.sql), version v5.4 theo header. Nguồn SHA-256: `770751bf506fa523b50bd6c51d235a6305b584c5e1fb63c3bd4e0eac040f5884`.

Baseline SHA-256: `7ea7b81d1da39210180fd9514c792ec7061303e4efc5949de222c41210c5f342`. [prisma/baseline.manifest.json](../prisma/baseline.manifest.json) lưu fingerprint cho chín nhóm catalog: bảng, cột/default/nullability, constraint, index/predicate, enum, extension namespace, trigger, function và policy. Không lưu dữ liệu nghiệp vụ, credentials hoặc bản dump.

## Đối chiếu Azure trước triển khai ngày 29/10/2026

Đã đọc catalog của `foodprint_db`, schema `foodprint`, PostgreSQL **18.6** trong transaction read-only. Sau đó replay nguyên baseline trên PostgreSQL **18** tạm và đối chiếu đầy đủ cả chín nhóm metadata; kết quả khớp.

| Thành phần baseline                         | Số lượng      |
| ------------------------------------------- | ------------- |
| Bảng / cột / enum                           | 43 / 415 / 27 |
| Khóa chính / FK / UNIQUE constraint         | 43 / 100 / 28 |
| CHECK constraint                            | 41            |
| Index tổng cộng, gồm index của PK/UNIQUE    | 124           |
| Index khai báo riêng / có điều kiện         | 53 / 8        |
| Function / trigger / policy trong foodprint | 0 / 0 / 0     |

`pgcrypto` và `citext` thuộc schema `public`, được giữ rõ trong baseline. Baseline chứa DDL và comments; không chạy role/permission seed hay mock data. Database mới sau migrate deploy vẫn cần bước seed được phê duyệt riêng. Hai file SQL thiết kế cũ được giữ nguyên làm tài liệu tham chiếu; không chạy lại file CREATE-from-scratch lên Azure đã có dữ liệu.

**Trạng thái tại lần đối chiếu ban đầu:** chưa có `_prisma_migrations`, chưa có `user_permission_denials`. Giai đoạn chuẩn hóa chỉ đọc Azure. Trạng thái triển khai tiếp theo được ghi riêng bên dưới; không suy ra từ việc file đã merge hoặc Client đã generate.

## Triển khai Azure ngày 29/10/2026

Đã triển khai theo yêu cầu sau khi [PR #8](https://github.com/SEP490-FoodPrint/be/pull/8) được review/merge vào `dev`, commit `204425115349d6b17fc20ba703b5076eb291e135`. [Backend CI trên commit đã merge](https://github.com/SEP490-FoodPrint/be/actions/runs/40827241450) PASS cả Code quality, PostgreSQL migrations và Backend quality trước bước ghi database.

Database đích: `foodprint_db`, schema `foodprint`, trên Azure PostgreSQL hiện hữu, kết nối SSL.

| Migration                                | Trạng thái                                                          | Hoàn tất (UTC)      |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------- |
| `0_init`                                 | Đã ghi nhận applied bằng migrate resolve; không replay baseline DDL | 2026-10-29 06:10:29 |
| `20261029000100_user_permission_denials` | Đã áp dụng bằng migrate deploy                                      | 2026-10-29 06:10:34 |

Xác minh sau triển khai lúc **06:11:27 UTC**:

- `migrate status`: Database schema is up to date; cả hai migration hoàn tất, checksum khớp SQL trong Git.
- `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`: No difference detected.
- Có **44 bảng nghiệp vụ**, không tính `_prisma_migrations`. Bảng mới có CHECK đúng một tổ chức đã validated, sáu FK và ba partial unique index hợp lệ.
- Số dòng của cả 43 bảng cũ và fingerprint của chín nhóm catalog cũ giữ nguyên so với snapshot ngay trước triển khai. Bảng mới có 0 dòng; không chạy seed, mock data, reset hoặc DML nghiệp vụ.

Azure đã nhận baseline; không chạy lại thủ tục nhận `0_init` trên database này. Dùng `npm run db:migrate:status` để kiểm tra lịch sử hiện tại. `db:baseline:check` chỉ dành cho cấu trúc ban đầu trước migration mở rộng, không dùng làm health check sau triển khai. Lần triển khai này được chạy thủ công theo yêu cầu. Workflow CD cho các migration tiếp theo được mô tả ở [README mục 10](../README.md#10-cd-migration-azure-từ-dev); việc kích hoạt còn cần environment/secrets và kết nối mạng trên GitHub/Azure.

## Triển khai phân quyền động ngày 29/10/2026

Migration `20261029000200_single_organization_admin` thêm `users.role_code`, backfill theo role hiện có, cập nhật timestamp, và đối chiếu `(role_id, role_code)` với `(roles.id, roles.code)` bằng FK ghép. UUID role, mật khẩu và role được gán cho tài khoản giữ nguyên. Hai partial unique index chỉ giới hạn SCHOOL_ADMINISTRATION theo school_id và INGREDIENT_SUPPLIER_ADMIN theo supplier_id; tài khoản inactive cũng được tính. Các CHECK yêu cầu admin ACTIVE gắn đúng loại tổ chức; tài khoản đăng ký chưa ACTIVE vẫn có thể tạm chưa có tổ chức như thiết kế đăng ký hiện hữu. Không thêm function/trigger hoặc bảng lịch sử.

Migration dừng và rollback nếu có admin trùng, không tự chọn/xóa/chuyển role tài khoản. Cấu trúc ban đầu 0_init và migration denial đã applied giữ nguyên. PostgreSQL integration tests kiểm tra giữ dữ liệu, từ chối admin trùng và unique khi ghi đồng thời.

Bootstrap permission là lệnh riêng `auth:bootstrap`, tách khỏi migration/CD. Catalog lấy từ SQL v5.4 cùng các permission cho endpoint hiện có; không import mock data. Chạy lại giữ quyền role ngoài SYSTEM_ADMIN đã chỉnh và các cờ inactive. System Admin không được sửa role SYSTEM_ADMIN qua API; bootstrap operator cấp quyền khởi tạo cho role này. Xem [quy trình phân quyền](../docs/AUTHORIZATION.md).

Đã merge [PR #13](https://github.com/SEP490-FoodPrint/be/pull/13) vào `dev`, commit `cfa20903dc1d5ea9b2a0f13b3e5fd9221f4cadd3`. [CI/CD trên commit đã merge](https://github.com/SEP490-FoodPrint/be/actions/runs/40865576138) PASS cả Code quality, PostgreSQL migrations, Backend quality và Azure database migration. CD áp dụng `20261029000200_single_organization_admin` lúc **11:29:11 UTC**; không chạy lại hai migration cũ.

Sau CD, đã chạy riêng bootstrap được phê duyệt từ đúng commit đã merge. Đối chiếu read-only lúc **11:34:48 UTC** xác nhận:

- Catalog có **11 role / 66 permission**; bootstrap thêm **4 liên kết** cho SYSTEM_ADMIN: `role.view`, `permission.view`, `permission.create`, `role_permission.manage`. Các permission này active và đã được gán; không cấp bypass hoặc quyền sửa role SYSTEM_ADMIN qua API.
- Cả **9 tài khoản** hiện có giữ nguyên dữ liệu nghiệp vụ, bao gồm role được gán và mật khẩu; phần thay đổi có chủ đích chỉ là backfill role_code và timestamp trong migration. Không tạo tài khoản hoặc mock data. Bộ quyền của mọi role ngoài SYSTEM_ADMIN giữ nguyên so với trước triển khai.
- Hai partial unique index `uq_users_school_admin`, `uq_users_supplier_admin` hợp lệ; FK ghép và hai CHECK tổ chức đã validated. Mọi users.role_code khớp roles.code.
- Cả ba migration hoàn tất, checksum khớp SQL trong Git. `db:migrate:status` báo up to date; Prisma diff báo `No difference detected` sau bootstrap.

Các con số là snapshot tại lần kiểm tra này; kiểm tra lại lịch sử và quyền thực tế khi vận hành. Bootstrap vẫn là thao tác operator riêng, không được thêm vào CD.

## Đồng bộ lịch sử và School profile ngày 31/10/2026

CD của `dev` tại `6a8a4e6` dừng vì Git thiếu hai migration đã applied trên Azure. Truy vấn chỉ đọc xác nhận năm migration hoàn tất, không có bản ghi lỗi/rollback. Ba SQL cũ vẫn khớp checksum; hai file gốc được khôi phục nguyên byte từ commit `45aaccdd51d848fb6f91529e5409a854ce1fac23` của `feat/supplier-contract-linking`:

| Migration                                  | SHA-256 trùng lịch sử Azure                                        |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `20261030000100_menu_day_approval`         | `a7b4782950c14db864473eff9448f4e6869536489041d648c08df6329bda6238` |
| `20261030000200_supplier_contract_linking` | `4c714ba825e20150df08433ad51fa5783d1837c830c31f057ba6823dbf91f9a9` |

Schema tương ứng được đồng bộ cùng SQL. Kiểm tra drift chỉ đọc phát hiện thêm cấu trúc School đã có trên Azure nhưng chưa được version hóa: address_line, location_id, description, logo_url, cover_image_url và boarding_scale. Migration mới `20261031000100_school_profile_baseline` ghi nhận cấu trúc này để database mới và Azure cùng hội tụ:

- Database còn address sẽ rename sang address_line, giữ nguyên nội dung. Nếu cả hai cột cùng tồn tại, migration dừng để review, không tự chọn/xóa dữ liệu.
- Các cột profile đã provision đúng kiểu, nullable và không có default được giữ nguyên; cột thiếu được bổ sung. FK/index location giữ nguyên khi đã có.
- Prisma vẫn dùng trường `School.address` nhưng map sang address_line; API và payload đăng ký hiện tại tiếp tục dùng address.
- Migration không seed, update dữ liệu hồ sơ hay thay quyền. SQL đã applied được giữ bất biến; không sửa/xóa `_prisma_migrations` để bỏ qua kiểm tra.

Bản sửa đã PASS Prisma validate, lint, format, typecheck, build, 105 unit tests, 7 migration tests và 27 authorization tests trên PostgreSQL local dùng một lần. Kiểm thử migration bao gồm nâng cấp baseline có địa chỉ cũ, cấu trúc profile đã provision và trường hợp hai cột địa chỉ xung đột. Kiểm tra Azure chỉ đọc báo lịch sử/checksum hợp lệ, một migration đang chờ và Prisma diff `No difference detected`. Migration School profile mới cần review, merge vào dev và được workflow CD áp dụng; phần này không xác nhận nó đã được deploy.

## Database đã tồn tại: nhận baseline một lần

Thủ tục dành cho database chưa nhận baseline; Azure hiện tại đã hoàn tất. Chỉ làm sau khi migration đã được review/merge và việc ghi lịch sử/chạy DDL trên database đích được cho phép. `DATABASE_URL` phải trỏ đúng database dự định triển khai.

```bash
npm run db:baseline:check
npm exec --no -- prisma migrate resolve --applied 0_init
npm run db:migrate:deploy
npm run db:migrate:status
```

`db:baseline:check` chỉ đọc metadata, kiểm tra checksum SQL và fingerprints, bỏ qua riêng bảng bookkeeping `_prisma_migrations`. Nó dừng nếu database khác baseline, kể cả thiếu CHECK mà Prisma schema diff không thể hiện. Không dùng lệnh này để kiểm tra trạng thái mới sau khi đã áp dụng migration tiếp theo.

`migrate resolve --applied 0_init` tạo/ghi lịch sử migration, không replay baseline DDL hoặc seed. Lệnh này không tự kiểm tra cấu trúc, vì vậy phải chạy check thành công ngay trước đó. `db:migrate:deploy` sau đó chỉ áp dụng migration còn thiếu, gồm UserPermissionDenial. Không chạy `migrate dev`, reset hoặc `db push` để nhận baseline trên Azure.

Nếu database đã có bảng mới do từng chạy patch thủ công, hoặc đã có lịch sử migration khác, cần đối chiếu riêng trước khi nhận lịch sử; không mặc định đánh dấu applied, không xóa bảng hoặc dữ liệu để chạy lại.

## Database local mới và thay đổi tiếp theo

Với database local mới, rỗng, do chính thành viên chuẩn bị:

```bash
npm run db:migrate:deploy
```

Lệnh áp dụng cả baseline và các migration tiếp theo. Nó vẫn dùng `DATABASE_URL`; phải chọn đúng database trước khi chạy. Mỗi member tiếp tục sử dụng database local riêng.

Khi thay đổi schema ở môi trường phát triển local:

```bash
npm run db:migrate:create -- --name descriptive_change
# Review SQL, bổ sung CHECK hoặc SQL không biểu diễn được trong Prisma.
npm run db:migrate
```

`db:migrate` và `db:migrate:create` từ chối host remote/Azure trước khi gọi Prisma. Chúng không tự đổi `.env`. Nếu `.env` đang dùng Azure, đặt `DATABASE_URL` local cho riêng lệnh. Giữ migration đã applied bất biến; thay đổi mới phải có thư mục migration mới. Không tạo lại manifest hoặc sửa `0_init` để làm biến mất drift.

## UserPermissionDenial và quy tắc giữ nguyên

Migration `20261029000100_user_permission_denials` thay thế patch độc lập `database/patches/001_user_permission_denials.sql`; chỉ còn một nguồn triển khai. Nó tạo một bảng, ba partial unique index, hai index hỗ trợ và sáu FK, trong transaction có giới hạn chờ lock/thời gian statement.

CHECK `chk_user_permission_denials_exactly_one_organization` bắt buộc:

```sql
num_nonnulls(school_id, supplier_id, commune_food_safety_unit_id) = 1
```

CHECK chặn cả INSERT và UPDATE có không tổ chức hoặc nhiều tổ chức. FK chỉ xác nhận tổ chức tồn tại; backend vẫn phải kiểm tra user/admin thuộc đúng tổ chức, permission thuộc role và đang active. API phân quyền động nằm trong backend, theo [quy trình phân quyền](../docs/AUTHORIZATION.md); migration này chỉ cung cấp cấu trúc denial, không tạo lịch sử bật/tắt quyền.

Các index có điều kiện cũ được giữ nguyên. Prisma dùng biểu thức PostgreSQL chuẩn hóa cho `uq_inventory_usage_per_batch_lot`, `uq_school_supplier_current`, default QR token và tên FK dài thực tế để tránh drift giả; không thay đổi nghĩa nghiệp vụ hoặc DDL đang có trên Azure. Dùng primary key thực cho thao tác unique khi index chỉ unique có điều kiện.

Baseline giữ mọi CHECK và quan hệ ghép, kể cả CookingBatch → MenuDayDish. Một IngredientLot vẫn có nhiều InventoryTransaction. 28 cột mapped `updated_at` được ORM cập nhật bằng `@updatedAt`; ghi ngoài Prisma phải cập nhật rõ ràng. Không có trigger tự xử lý lifecycle, inventory posting hoặc phân quyền actor; service chịu trách nhiệm và dùng transaction cho các ghi cần nguyên tử.

## Kiểm tra và CI

```bash
npm run prisma:validate
npm run prisma:generate
npm run validate
npm run test:unit
# Chỉ với PostgreSQL local test mới, dùng một lần; không trỏ Azure:
MIGRATION_TEST_DATABASE_URL='<local-test-url>' npm run test:migrations
MIGRATION_TEST_DATABASE_URL='<local-test-url>' npm run test:authorization
```

URL test phải trỏ loopback và database có tên `foodprint_migration_test` hoặc `foodprint_migration_test_<suffix>`, chưa có schema `foodprint`. Test không drop/reset database hoặc xóa volume. Nó kiểm tra replay baseline, phát hiện CHECK bị thiếu, nhận baseline trên database có dữ liệu mẫu để chứng minh dữ liệu được giữ, deploy/redeploy, drift bằng 0, fresh deploy và các tổ hợp tổ chức hợp lệ/không hợp lệ.

CI dựng PostgreSQL 18 tạm cho job migration và integration phân quyền, tách khỏi database thực; job này tự generate Prisma Client trước khi test. Check bắt buộc `Backend quality` tổng hợp kết quả code quality và job PostgreSQL; một nhánh lỗi hoặc bị bỏ qua sẽ làm check tổng hợp thất bại. Sau khi CI của push vào `dev` PASS, workflow CD có thể triển khai pending migrations bằng environment `azure-dev` đã cấu hình. `npm run db:deploy:check` chỉ đọc, xác nhận đúng host/database/schema/SSL và đối chiếu checksum mọi migration đã applied. CD dừng nếu chưa nhận baseline, có migration lỗi, file bị sửa/xóa hoặc database đi trước commit. CD không tự nhận baseline hay xử lý lỗi bằng reset/resolve. Xem [cấu hình và vận hành CD](../README.md#10-cd-migration-azure-từ-dev).
