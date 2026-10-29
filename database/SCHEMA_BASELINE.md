# Baseline database và lịch sử migration

## Nguồn chuẩn

Lịch sử triển khai schema được quản lý tại `prisma/migrations/`, với provider PostgreSQL và Prisma CLI/Client theo lockfile hiện tại (**7.10.1**). `prisma/schema.prisma` mô tả trạng thái đích; các CHECK và SQL riêng của PostgreSQL nằm trong migration.

| Migration                                | Nội dung                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `0_init`                                 | Baseline cấu trúc v5.4 đang có trên Azure, trước UserPermissionDenial                        |
| `20261029000100_user_permission_denials` | Thêm bảng quyền bị tắt theo user/tổ chức, FK, partial unique index và CHECK đúng một tổ chức |

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

Azure đã nhận baseline; không chạy lại thủ tục nhận `0_init` trên database này. Dùng `npm run db:migrate:status` để kiểm tra lịch sử hiện tại. `db:baseline:check` chỉ dành cho cấu trúc ban đầu trước migration mở rộng, không dùng làm health check sau triển khai. Đây là lần triển khai thủ công được cho phép; chưa có CD tự deploy.

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

CHECK chặn cả INSERT và UPDATE có không tổ chức hoặc nhiều tổ chức. FK chỉ xác nhận tổ chức tồn tại; backend vẫn phải kiểm tra user/admin thuộc đúng tổ chức, permission thuộc role và đang active. Model/migration chưa triển khai API phân quyền động hoặc lịch sử bật lại quyền.

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
```

URL test phải trỏ loopback và database có tên `foodprint_migration_test` hoặc `foodprint_migration_test_<suffix>`, chưa có schema `foodprint`. Test không drop/reset database hoặc xóa volume. Nó kiểm tra replay baseline, phát hiện CHECK bị thiếu, nhận baseline trên database có dữ liệu mẫu để chứng minh dữ liệu được giữ, deploy/redeploy, drift bằng 0, fresh deploy và các tổ hợp tổ chức hợp lệ/không hợp lệ.

CI dựng PostgreSQL 18 tạm cho job migration, tách khỏi database thực. Check bắt buộc `Backend quality` tổng hợp kết quả code quality và migration; một nhánh lỗi hoặc bị bỏ qua sẽ làm check tổng hợp thất bại. Chưa có workflow CD hoặc quyền tự deploy Azure.
