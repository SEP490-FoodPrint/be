# Quickstart: Kiểm chứng quản lý nguyên liệu nhà cung cấp

Áp dụng sau khi triển khai và sinh tasks; các lệnh dưới đây chưa được chạy trong bước plan. Chi tiết input/output tại [contract](contracts/ingredient-management.md), dữ liệu tại [data-model.md](data-model.md).

## Điều kiện

- Node theo .nvmrc, npm 11, dependencies lockfile; .env local không commit.
- MIGRATION_TEST_DATABASE_URL trỏ PostgreSQL local disposable được chọn tường minh, tài khoản có quyền tạo DB tạm theo harness. Không dùng Azure hoặc database thành viên đang sử dụng.
- Fixture DB tạm gồm supplier A/B ACTIVE, admin A/B, staff A, vai trò khác; danh mục, nguyên liệu ACTIVE/INACTIVE và hồ sơ liên kết. Fixture không phải seed trên DB sử dụng.
- HTTP test dùng auth injection theo harness; kiểm chứng thủ công cần token thật, dữ liệu thử hợp lệ và Redis local.

## Kiểm tra tự động sau triển khai

```sh
npm ci
npm run prisma:validate
npm run prisma:generate
npm run validate
npm run test:unit
npm run test:migrations
npm run test:authorization
npm run test:supplier-onboarding
```

Đăng ký tests/ingredient-management.test.ts trong test:unit. Integration dùng biến môi trường thiết lập ngoài tài liệu, không log URL/credential. Spec gate chỉ chạy sau khi có tasks và commit hợp lệ theo hướng dẫn repo.

Migration tests phải kiểm tra fresh deploy và nâng cấp từ schema ngay trước migration mới với dữ liệu category null/blank, trùng giữa supplier, khác hoa/thường và khoảng trắng bao quanh. Kiểm tra mapping chính xác, giữ ingredient id/supplier/FK, ảnh null/[]; không chỉ kiểm tra schema rỗng.

## Kiểm chứng HTTP

Nếu local DB đã được cập nhật theo nhiệm vụ triển khai được phép:

```sh
docker compose up -d --no-recreate --wait redis
npm run redis:check
npm run db:check
npm run dev
```

Không chạy migration trên DB đang sử dụng chỉ vì quickstart. Không db push/reset/import/bootstrap catalog để giải quyết test. Dùng base /api/ingredients/management và token đăng nhập thật của fixture.

| Kịch bản                                               | Kết quả                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Admin A tạo chỉ name/defaultUnit                       | 201, supplier A, ACTIVE, category/cover null, ảnh []                      |
| Một cover và ba ảnh mô tả kèm danh mục                 | Đọc lại đủ, đúng thứ tự và category                                       |
| Sửa một trường; cover null/ảnh []                      | Giữ trường không gửi, xóa ảnh rõ ràng                                     |
| Staff có manage, admin thiếu quyền, System Admin       | Sáu endpoint quản trị đều 403                                             |
| Admin A thao tác ingredient B hoặc UUID không tồn tại  | Cùng 404, không lộ dữ liệu B                                              |
| supplierId/status/category cũ/categoryId không tồn tại | 400, không lưu                                                            |
| Nhiều cover/ảnh sai/tên rỗng/nhiều issue               | 400, field paths, không lộ input                                          |
| Tên trùng cùng supplier kể cả ẩn                       | 409; cùng tên khác supplier được phép                                     |
| Hai create/update đồng thời cùng tên                   | Tối đa một thành công, không trùng dữ liệu                                |
| Thu hồi quyền/khóa actor hoặc supplier trong lúc ghi   | Quyết định theo trạng thái hợp lệ tại điểm tuần tự hóa, không ghi dở dang |
| Ẩn rồi ẩn lại, sửa nguyên liệu ẩn                      | 200 INACTIVE, vẫn ẩn, giữ FK                                              |
| Menu options/supplier discovery sau ẩn                 | Không trong lựa chọn mới, lịch sử vẫn đọc được                            |
| GET /api/ingredients với staff có quyền đọc            | Hành vi đọc cũ giữ nguyên, quản trị vẫn bị chặn                           |
| Danh mục rỗng/page cuối                                | items [], hasNext false; tạo chưa phân loại được phép                     |
| Consumer category legacy                               | Giữ string/null và filter tên cũ                                          |

## Ghi nhận kết quả

Đối chiếu FR-001–014 và SC-001–005; ghi lệnh đã chạy, kết quả và prerequisite thiếu. Không ghi PASS cho integration chưa chạy. Không log token/credential. Kiểm tra diff cuối không có generated Prisma/dist/.env/.specify/feature.json.

## Triển khai — prerequisite

Node 24.22.1/npm 11.19.1 và dependencies có sẵn. Ignore files đã kiểm tra. Test dùng container riêng foodprint-spec008-tests, PostgreSQL 18 với tmpfs; không dùng database thành viên. Không có extension hooks.

## Kết quả triển khai và kiểm chứng — 2026-11-08

Đã hoàn thành 40/40 task của spec 008 trên nhánh feat/008-supplier-ingredient-management.

| Kiểm tra                          | Kết quả cuối                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| prisma:validate / prisma:generate | PASS                                                                                                   |
| npm run validate                  | PASS: lint, format:check, typecheck, build                                                             |
| npm run test:unit                 | PASS: 229/229, gồm 12 test ingredient management                                                       |
| npm run test:migrations           | PASS: 10/10 trên database mới trong PostgreSQL 18 tạm                                                  |
| npm run test:authorization        | PASS: 37/37, gồm management HTTP, unique races, hide/update và stale actor recheck                     |
| npm run test:supplier-onboarding  | PASS: 8/8, gồm ẩn khỏi lựa chọn mới và giữ menu/contract/order evidence                                |
| Spec gate                         | PASS trên nội dung working tree thực tế với nhánh 008 và ba file spec/plan/tasks; chưa phải kết quả CI |
| git diff --check                  | PASS                                                                                                   |

Migration fixture bao phủ null/blank, trùng tên phân loại trong và giữa nhà cung cấp, chữ hoa/thường, khoảng trắng bao quanh, giữ id/FK, một category dùng chung, default ảnh và CHECK/FK Restrict. Supplier onboarding kiểm tra không có Prisma schema drift.

Kiểm thử dùng container riêng foodprint-spec008-tests với tmpfs; container được dừng sau kiểm chứng. PostgreSQL và Redis đang có của thành viên không bị recreate, flush hoặc xóa volume. Không có prerequisite kiểm thử còn bị chặn.

Chưa commit/push hoặc deploy migration lên database đang sử dụng/Azure. Mã migration chỉ được áp dụng trong các database kiểm thử tạm của nhiệm vụ này. Khi triển khai thực tế, phối hợp migration và phiên bản ứng dụng trong cửa sổ bảo trì theo data-model.md.

Không có .specify/extensions.yml tại lần kiểm tra cuối: không có after_implement hook cần thực thi. Không thêm upload ảnh, bộ quản trị danh mục, xóa nguyên liệu hoặc chức năng bật lại.
