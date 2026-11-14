# Quickstart: Kiểm chứng quản lý cơ sở cung cấp

**Branch**: feat/026-source-facility-management

Tài liệu này hướng dẫn kiểm chứng chức năng đã triển khai. Kết quả thực thi ngày 2026-11-14 được ghi ở cuối tài liệu; phần thiết kế ban đầu không chạy kiểm thử hạ tầng. Xem [contract](contracts/source-facility-api.md) và [data model](data-model.md) để đối chiếu kết quả.

## 1. Chuẩn bị

- Node.js theo .nvmrc và npm theo package.json; dependencies đã được cài bằng npm ci khi cần.
- Chạy từ repository root. DATABASE_URL/JWT_SECRET cấu hình riêng theo hướng dẫn dự án; không đưa credential vào tài liệu hoặc log.
- Unit/HTTP dùng dependency injection, không kết nối PostgreSQL/Redis.
- Integration yêu cầu MIGRATION_TEST_DATABASE_URL chỉ rõ instance PostgreSQL local disposable, database selector foodprint_migration_test hoặc tên có hậu tố hợp lệ; REDIS_URL local cho phiên đăng nhập. Không trỏ selector vào database thành viên hoặc Azure.
- Suite authorization tự tạo database có tên ngẫu nhiên, áp migration/bootstrap và fixture chỉ trong database đó, đóng kết nối và dọn đúng tài nguyên do suite tạo. Không bootstrap database đang sử dụng.

## 2. Kiểm tra chất lượng sau triển khai

```sh
npm run prisma:validate
npm run validate
npm run test:unit
```

validate bao gồm lint, format, typecheck và build/generate; không cần chạy lại riêng các bước đã đạt nếu không có thay đổi mới. Unit suite phải bao gồm tests/source-facility-management.test.ts. Có thể chạy riêng file này trong vòng sửa lỗi trước khi chạy bộ kiểm tra cuối:

```sh
npm exec -- tsx --test tests/source-facility-management.test.ts
```

Kỳ vọng: schema hiện có vẫn hợp lệ; source/DTO/repository strict types và CommonJS build thành công; unit/HTTP không dùng hạ tầng.

## 3. Kiểm thử PostgreSQL và phiên thực

Chỉ chạy phần này khi instance disposable đã được chọn tường minh và việc tạo database test trên instance đó đã được cho phép. Không dùng db:push, reset hoặc migrate lên DATABASE_URL của thành viên để chuẩn bị kiểm thử.

Nếu Redis local chưa chạy, dùng đúng lệnh dự án:

```sh
docker compose up -d --no-recreate --wait redis
npm run redis:check
npm run test:authorization
```

MIGRATION_TEST_DATABASE_URL và REDIS_URL phải được thiết lập trước khi chạy; không in URL chứa credential. Suite hiện có được mở rộng với nhóm source facility, nên CI đã gọi test:authorization sẽ kiểm tra cùng các ca mới; không cần script/workflow riêng.

## 4. Các kịch bản bắt buộc

| Nhóm                | Thực hiện trong fixture disposable                                                     | Kết quả cần chứng minh                                                                          |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tạo tối thiểu       | Supplier admin A gửi chỉ name                                                          | 201; FP-SF-00001; ACTIVE/isVisible=true; bốn optional null; audit actor đúng.                   |
| Dãy độc lập         | A tạo tiếp, B tạo cơ sở đầu                                                            | A nhận 00002; B nhận 00001; supplier sở hữu đúng.                                               |
| Phân quyền          | Staff được grant manage, SYSTEM có manage, thiếu permission, account/supplier inactive | Cả năm endpoint bị chặn; không thay dữ liệu.                                                    |
| Thu hồi quyền       | Middleware đã tải actor, nhưng actor bị deny/đổi scope trước write transaction         | Không ghi; việc kiểm tra lại dùng cùng tx như mutation.                                         |
| Input               | Readonly fields kể cả null/empty; nhiều lỗi; PATCH {}; UUID/mã công khai sai params    | 400 với error.fields tiếng Việt; không raw values hoặc partial writes.                          |
| Danh sách           | 45 cơ sở A, cơ sở B, ACTIVE/INACTIVE/isVisible=false                                   | Ba trang 20/20/5, thứ tự ổn định, hasNext đúng; không lẫn B.                                    |
| Chi tiết/tenant     | A đọc/sửa/dừng UUID của B và UUID không tồn tại                                        | Cùng 404; không tiết lộ B.                                                                      |
| PATCH               | Sửa một trường, clear optional, sửa cơ sở INACTIVE                                     | Omitted giữ nguyên; code/status/created audit không đổi.                                        |
| Dừng và lịch sử     | Dừng cơ sở có IngredientLot rồi dừng lặp                                               | INACTIVE, link/sourceFacilityId giữ nguyên; isVisible/mã giữ nguyên; lặp không ghi audit mới.   |
| Tên trùng           | Hai create cùng tên trong A; cùng tên ở B                                              | Một thành công/một 409 ở A; B được phép.                                                        |
| Cấp số đồng thời    | Hai create khác tên trên hai connection cùng supplier, ép cùng thời điểm               | Các create thành công có mã khác; retry toàn transaction khi cần; không giả lập lock bằng mock. |
| Cross-supplier lock | Giữ khóa supplier A và tạo cơ sở B                                                     | Không sử dụng khóa/bộ đếm toàn cục; B độc lập về dãy mã.                                        |
| Mốc số              | Mã canonical cao nhất 99999; thêm mã > Number.MAX_SAFE_INTEGER                         | Cấp đúng theo số, không lexicographic/rounding.                                                 |
| Legacy              | Null/mã không chuẩn, canonical cao ở INACTIVE/isVisible=false                          | Không đổi dữ liệu cũ; chỉ canonical tham gia max, không lọc mất mã đã dừng.                     |
| Rollback/retry      | Lỗi trước commit, xung đột code, exhaustion                                            | Không partial writes; code conflict được retry thay vì 409 tên; hết lượt 503.                   |
| Bất biến            | Sửa/dừng/restart service rồi tạo tiếp                                                  | Không đổi mã đã cấp, không reset hoặc tái sử dụng mã.                                           |

Concurrency test đặt barrier/hook sau lần đọc actor tạo snapshot và trước khóa supplier, chỉ ở attempt đầu; không đặt sau khóa vì sẽ gây chờ nhau giữa hai writer cùng supplier. Không bắt retry đợi barrier đã dùng hết. Không dùng sleep hoặc Promise.all mock làm bằng chứng race PostgreSQL. Giữ fixture/barrier theo mẫu helpers hiện có và đóng mọi connection trước cleanup. Các fixture số lớn là dữ liệu kiểm thử trong DB mới, không phải seed triển khai.

Kiểm tra thêm giới hạn varchar(80): formatter chấp nhận mã có hậu tố 74 chữ số; khi đã có mã canonical gồm 74 chữ số 9, lần tạo tiếp theo phải trả 503, không insert hoặc thay đổi dữ liệu cũ.

## 5. Ghi kết quả

Ghi lệnh đã chạy, pass/fail, thời gian nhóm concurrency/fixture lớn và prerequisite bị thiếu. Không tuyên bố kiểm chứng PostgreSQL khi chỉ chạy unit. Không cần test migration mới vì feature giữ nguyên schema; suite migration sẵn có của CI vẫn chạy như trước.

Sau khi các kiểm tra cần thiết đạt, đối chiếu SC-001–006 trong spec, docs/AUTHORIZATION.md và src/modules/README.md đã cập nhật đủ năm endpoint. Chỉ đưa code vào PR khi có đủ spec.md, plan.md và tasks.md trên nhánh feature.

## Implementation log — 2026-11-14

- T001: Node v24.22.1, npm 11.19.1; nhánh feat/026-source-facility-management; dependencies đã có. Git/Docker/ESLint/Prettier ignores đã bao phủ artifacts, .env, dependencies và client sinh tự động; không cần sửa ignore hoặc thêm dependency.
- Kiểm thử DB chọn container PostgreSQL 18 tạm riêng foodprint-sf-test-026, cổng loopback 55432, selector foodprint_migration_test; không dùng PostgreSQL thành viên tại cổng 5433. Redis local hiện có dùng session/key test riêng theo suite. Container DB tạm sẽ được dừng sau kiểm chứng.
- Typecheck đầu tiên cho thấy Prisma Client có sẵn chưa theo kịp schema hiện tại (thiếu SchoolGrade/DishCategory và các model khác); sinh lại client trước kiểm tra cuối, không sửa schema/database.

### Kết quả kiểm chứng cuối

| Kiểm tra                       | Kết quả                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| npm run prisma:validate        | PASS                                                                                        |
| npm run validate               | PASS: lint, format:check, typecheck và build/generate                                       |
| npm run test:unit              | PASS 442/442, gồm 21 test source facility; khoảng 16,7 giây                                 |
| npm run test:authorization     | PASS 43/43 trên PostgreSQL 18 tạm và Redis local; khoảng 17,6 giây                          |
| Race/rollback source facility  | PASS; hai transaction thật cùng snapshot, có retry toàn transaction; khoảng 141 ms cho nhóm |
| Legacy/mốc số/giới hạn mã      | PASS; gồm trailing newline, mã >64-bit và hết varchar(80); khoảng 101 ms cho nhóm           |
| Read/update/deactivate/history | PASS; 45 cơ sở, tenant/role/audit/link lịch sử; khoảng 755 ms cho nhóm                      |

Các thời gian trên là số đo một lần trên fixture kiểm thử local, không phải SLA tải production. Kiểm thử dữ liệu chỉ chạy trong các database mới do suite tạo trong container tạm; không kết nối PostgreSQL thành viên ở cổng 5433 hoặc Azure. Không thay schema, migration, .env hay dữ liệu kinh doanh hiện có. Container PostgreSQL tạm được dọn sau khi hoàn tất; Redis hiện có được giữ nguyên, chỉ các key phiên/fixture do suite tạo được cleanup theo helper.

Lượt unit toàn dự án đầu tiên có 441/442 test đạt: test generic list scope còn giả định mọi SYSTEM được gán quyền đều có scope toàn cục. Đã cập nhật tests/authorization.test.ts để khẳng định source-facility vẫn phải từ chối SYSTEM, đồng thời giữ kiểm tra phạm vi của các tài nguyên khác; lượt cuối đạt 442/442.

Sandbox chặn IPC socket của tsx nên các lệnh unit/HTTP và integration được chạy ngoài sandbox sau phê duyệt công cụ. Test DB dùng cấu hình process riêng, không ghi URL hoặc credential vào .env.
