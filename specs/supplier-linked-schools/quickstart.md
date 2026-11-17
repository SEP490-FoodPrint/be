# Quickstart: Kiểm chứng trường đã liên kết và hợp đồng phía nhà cung cấp

**Plan**: [plan.md](plan.md) | **API**: [supplier-schools-api.md](contracts/supplier-schools-api.md)

Đây là hướng dẫn nghiệm thu và nhật ký kiểm chứng triển khai backend cho module `supplier-school`. Các kiểm tra tự động local cho SC-001–SC-005 đã chạy đạt theo nhật ký ở mục 7; **SC-006 chưa đo** (chờ giao diện hoàn chỉnh) và chưa commit/push hay thay đổi quyền/dữ liệu trên môi trường thành viên/Azure.

## 1. Điều kiện

- Node/npm theo .nvmrc và package.json; dependencies khóa đã cài; Prisma Client được sinh khi cần.
- Chỉ chạy phần DB khi đã có instance PostgreSQL local được chọn tường minh và quyền chạy test trên các database disposable của invocation. Dùng .env.test.local ignored theo .env.test.example, không dùng Azure hoặc database đang chứa dữ liệu thành viên.
- Dùng runner local hiện có, ghi tên sau CREATE thành công và cleanup đúng manifest; không tạo container PostgreSQL mới, reset database hoặc xóa theo prefix.
- Test real login có thể dùng session store isolated đã có của integration suite; nghiệm thu runtime dùng phiên/Redis hiện hành theo [AUTH_SESSIONS.md](../../docs/AUTH_SESSIONS.md).
- Không chạy migration, bootstrap, role update hay seed trên database đang dùng chỉ để lập kế hoạch hoặc đọc tài liệu.

## 2. Cấu hình quyền cho rollout

Catalog source sẽ thêm default existing permission supplier_relationship.view cho INGREDIENT_SUPPLIER_ADMIN. Khi bootstrap tạo role lần đầu trong database mới, role nhận grant này; test phải kiểm tra default đó.

Với role đã tồn tại, chạy lại auth:bootstrap không bổ sung grant mới vì công cụ giữ nguyên cấu hình role tenant. Operator SYSTEM_ADMIN có role_permission.manage cần dùng quy trình quản lý quyền đã duyệt:

1. Đọc roleId của INGREDIENT_SUPPLIER_ADMIN và permissionId của supplier_relationship.view từ chức năng danh mục/role hiện hành; xác minh permission đang active.
2. GET /api/roles/:roleId/permissions, kiểm tra và giữ toàn bộ grants hiện tại.
3. Nếu chưa có quyền đọc liên kết phù hợp, chuẩn bị tập permissionIds hiện tại cộng permissionId xem, rồi PUT /api/roles/:roleId/permissions theo quy trình quản trị hiện hành và xác nhận cấu hình mới. PUT là thay toàn bộ tập grants, không phải thêm riêng một quyền; không gửi chỉ permissionId mới.
4. API replace role yêu cầu mọi permission gửi vào đang active. Nếu grants hiện tại gồm permission inactive, không tự bỏ grant hoặc bật cờ để cho PUT thành công; operator phải giải quyết qua quy trình quản trị được duyệt trước khi áp dụng thay đổi này.
5. Denial cá nhân trong tổ chức hiện tại và permission inactive vẫn được tôn trọng; không gỡ/bật tự động. Admin có quyền manage hiệu lực cũng đọc được mà không cần grant view riêng.

Các bước trên là hướng dẫn cho operator, không được plan hoặc implementation tự thực thi lên hệ thống đang dùng.

## 3. Kiểm tra tự động sau implement

Chạy từ repository root:

```bash
npm run validate
npm run test:unit
```

test:unit phải chứa tests/supplier-school.test.ts. Sau khi đã được phép dùng instance test local và các database disposable:

```bash
npm run test:local:authorization
```

Runner hiện chạy authorization.integration.test.ts và supplier-onboarding.integration.test.ts bằng hai child process tuần tự. Đây cũng là các suite đã có trong CI (test:authorization và test:supplier-onboarding), nên regression mới phải nằm trong chúng và thực sự được thực thi.

Kỳ vọng: validate/unit/integration pass, không skip regression mới; cleanup database thuộc invocation hoàn tất. Không cần migration mới; integration vẫn replay lịch sử migration hiện có vào database disposable như hạ tầng đang làm.

## 4. Bộ dữ liệu và kịch bản đối chiếu

Fixture chỉ được tạo bên trong test database disposable, qua helper hiện có hoặc setup test; không tạo tài khoản mẫu/seed trong DB thành viên.

| Nhóm         | Dữ liệu/thao tác                                                                                       | Kỳ vọng                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Actor        | Hai supplier admin A/B; staff, school actor, SYSTEM, admin thiếu quyền                                 | Chỉ admin có view/manage hiệu lực truy cập; staff/SYSTEM/sai org403                                      |
| Quan hệ      | Một trường dùng chung A/B, một trường chỉ A, một chỉ B, một chưa liên kết, một chỉ có DRAFT            | Mỗi admin chỉ thấy trường đã có quan hệ của mình; trường chưa liên kết/DRAFT-only không có               |
| Đại diện     | Nhiều UNLINKED, relink ACTIVE/SUSPENDED, linkedAt trùng và trường có id khác                           | Đúng priority/status/time/id, mỗi trường một mục, đúng order toàn danh sách                              |
| Phân trang   | Nhiều hơn 20 trường/hợp đồng; limit 1; trang cuối và trang vượt                                        | Đủ kết quả không trùng/mất khi data không đổi; hasNext chính xác; parent hợp lệ mới trả list rỗng        |
| Hồ sơ        | Trường INACTIVE; trường thiếu thông tin tùy chọn; liên kết SUSPENDED/UNLINKED                          | Vẫn tra cứu được; trạng thái độc lập và nullable không được tự điền                                      |
| Hợp đồng     | ACTIVE hiện tại/tương lai/hết hạn; CLOSED; các đợt cũ; legacy relationshipId null; DRAFT               | Chỉ ACTIVE/CLOSED đúng cặp; không lọc ngày/current relationship; DRAFT404 cả direct detail               |
| Tệp          | Nhiều SIGNED_CONTRACT/APPENDIX, COMPLIANCE và tệp nháp; PDF/PNG/JPEG; tên Unicode                      | Đủ metadata tệp phù hợp, không content/sha256; mở/tải đúng bytes và tên/MIME/headers; COMPLIANCE/nháp404 |
| Lỗi nội dung | Thiếu document record; mô phỏng bytes rỗng/lỗi đọc bằng unit seam                                      | Record thiếu404; nội dung hỏng503 trước success headers, không200 rỗng; hồ sơ/hợp đồng vẫn đọc riêng     |
| Chéo phạm vi | Tráo schoolId/contractId/documentId giữa A/B và giữa trường của cùng A                                 | Cùng404 như id không tồn tại; không tên tệp/metadata của bên khác                                        |
| Thay quyền   | Cùng phiên sau khóa account, đổi role/membership, tắt grant hoặc denial cả view/manage                 | Request tiếp theo dùng trạng thái/quyền mới, không reuse quyền của request trước                         |
| Input        | UUID sai; query supplierId/orgId; page 0/-1/1.5, limit 101, overflow, query dạng mảng; disposition sai | 400 tiếng Việt có field paths, không raw input                                                           |
| No-write     | So trạng thái/dữ liệu liên kết/hợp đồng/tệp trước và sau toàn bộ GET                                   | Không thay đổi; các thao tác và quyền API phía trường vẫn hoạt động như trước                            |
| Bootstrap    | Catalog fresh và bootstrap với role đã cấu hình                                                        | Fresh admin có view; grants role cũ/inactive flags/denials được bảo toàn                                 |

Unit phải xác minh repository select không lấy bytes trong metadata, WHERE chứa scope đủ chuỗi parent và service mapping không spread record. PostgreSQL thực phải chứng minh thứ tự DISTINCT ON trước LIMIT, không chỉ kiểm tra kết quả mock.

## 5. Tra cứu thủ công bằng phiên hợp lệ

Chuẩn bị session cookie file riêng ở vị trí ignored/ngoài repository, không đưa credentials vào tài liệu hoặc Git. Các biến sau là placeholders phải được operator điền bằng phiên và tài nguyên của mình:

```bash
curl --fail-with-body --cookie "$SUPPLIER_SESSION_COOKIE_FILE" \
  "$SUPPLIER_API_BASE/api/supplier-schools?page=1&limit=20"
curl --fail-with-body --cookie "$SUPPLIER_SESSION_COOKIE_FILE" \
  "$SUPPLIER_API_BASE/api/supplier-schools/$LINKED_SCHOOL_ID"
curl --fail-with-body --cookie "$SUPPLIER_SESSION_COOKIE_FILE" \
  "$SUPPLIER_API_BASE/api/supplier-schools/$LINKED_SCHOOL_ID/contracts?page=1&limit=20"
curl --fail-with-body --cookie "$SUPPLIER_SESSION_COOKIE_FILE" \
  "$SUPPLIER_API_BASE/api/supplier-schools/$LINKED_SCHOOL_ID/contracts/$LINKED_CONTRACT_ID"
curl --fail-with-body --cookie "$SUPPLIER_SESSION_COOKIE_FILE" \
  "$SUPPLIER_API_BASE/api/supplier-schools/$LINKED_SCHOOL_ID/contracts/$LINKED_CONTRACT_ID/documents/$LINKED_DOCUMENT_ID?disposition=attachment" \
  --output "$SUPPLIER_DOCUMENT_OUTPUT"
```

Không in binary vào terminal. Đối chiếu nội dung tải xuống với tệp fixture trường tải lên; kiểm tra inline/attachment cho cùng bytes. Dùng phiên B truy cập tài nguyên chỉ của A phải404; truy cập trường dùng chung chỉ trả hợp đồng của B.

## 6. Ghi nhận kết quả

- Ghi lệnh thực tế, pass/fail/skip và prerequisites thiếu; không coi việc viết test là đã kiểm chứng.
- SC-001–SC-005 cần chứng cứ từ unit và PostgreSQL/HTTP, bao gồm tập kỳ vọng so với các trang thực tế.
- SC-006 phải đo trên luồng giao diện hoàn chỉnh: ít nhất 90% quản trị viên tham gia tìm được trường được chỉ định và mở đúng tệp trong tối đa 1 phút. Hiện chưa có frontend trong phạm vi backend nên để chưa nghiệm thu, không tự đánh dấu pass bằng HTTP latency.
- Đã có [tasks.md](tasks.md) gồm 40 task. Khi implementation sẵn sàng, chạy spec gate trên diff/commit thực của nhánh theo contribute.md mục 8.5; việc tạo đủ tài liệu không thay thế kiểm chứng gate trên thay đổi thực tế.

## 7. Nhật ký triển khai và kiểm chứng

### Baseline trước triển khai (T001)

- Đối chiếu `spec.md`, `plan.md`, `AGENTS.md` và `.specify/memory/constitution.md`: nhánh `feat/supplier-linked-schools`, checklist `checklists/requirements.md` đạt 16/16 mục; chưa thêm model/migration/seed hay sửa quyền dữ liệu thực.
- Kiểm tra điều kiện test local đã cấu hình trong `.env.test.local` (ignored):
  - `npm run test:local:check` → PASS (`PostgreSQL local 127.0.0.1:5433, version 18.6 (Debian 18.6-1.pgdg13+2), database foodprint_migration_test`).
  - `npm run redis:check` → PASS (`PASS: Redis local PONG`).
- Phạm vi nghiệm thu: chỉ dùng các database disposable do `tests/helpers/run-local-tests.ts` tạo và ghi manifest cho invocation hiện tại; không đụng database thành viên hoặc Azure. **SC-006 chưa đo** (chờ giao diện và luồng sử dụng hoàn chỉnh phía người dùng).

### Checkpoint US1 (T016 — SC-001, SC-005)

- Unit/HTTP US1 (`node --import tsx --test tests/supplier-school.test.ts`): 5/5 PASS (validation, router guard, SQL `DISTINCT ON`, mapping `id`+`code`, pagination, `private, no-store`, 503 sanitized).
- Integration PostgreSQL thực (`npm run test:local:authorization`): `authorization.integration.test.ts` 56/56 PASS, `supplier-onboarding.integration.test.ts` 9/9 PASS (cô lập hai nhà cung cấp, trường dùng chung, trường chưa liên kết/DRAFT-only, trường INACTIVE, đại diện ACTIVE thắng UNLINKED mới hơn bất thường, tie `linked_at`/`id` và `school_id`, duyệt toàn bộ 22 trường nhiều trang không trùng/mất; runner dọn 4/4 database thuộc manifest).

### Checkpoint US2 (T022 — SC-002, SC-003)

- Unit/HTTP US2 (`node --import tsx --test tests/supplier-school.test.ts`): 8/8 PASS (allowlist `SchoolDetail`, nullable fields, relationship mốc/lý do, không nhúng hợp đồng, 404 đồng nhất, 400 query lạ, 503 sanitized).
- Integration PostgreSQL thực (`npm run test:local:authorization`): `authorization.integration.test.ts` 56/56 PASS, `supplier-onboarding.integration.test.ts` 10/10 PASS (truy cập trực tiếp chi tiết trường không cần gọi list trước, trường chung tách quan hệ theo supplier, trường `INACTIVE` + `SUSPENDED`/`UNLINKED` không có hợp đồng vẫn 200, tie `UNLINKED`, 404 đồng nhất cho trường của supplier khác / DRAFT-only / không tồn tại; runner dọn 4/4 database).

### Checkpoint US3 (T031 — SC-002, SC-003, SC-004, SC-005)

- Unit/HTTP US3 (`node --import tsx --test tests/supplier-school.test.ts`): 11/11 PASS (parent 404 tách biệt list hợp đồng rỗng 200, sort/paging/allowlist hợp đồng không lộ `createdAt`/`snapshot`/`sha256`/`content`, binary inline/attachment cùng bytes, RFC 5987 encode tên UTF-8/control chars, `nosniff`/`sandbox`/`private, no-store`, 404 thiếu bản ghi, 503 khi bytes rỗng/MIME sai/lỗi đọc trước khi đặt success headers).
- Integration PostgreSQL thực (`npm run test:local:authorization`): `authorization.integration.test.ts` 56/56 PASS, `supplier-onboarding.integration.test.ts` 11/11 PASS (hợp đồng `ACTIVE` tương lai/hết hạn + `CLOSED` đợt cũ, nguyên liệu `INACTIVE` vẫn giữ trên hợp đồng, metadata chỉ `SIGNED_CONTRACT`/`APPENDIX`, mở/tải PDF/PNG/JPEG khớp byte gốc, 404 cho `DRAFT`/`COMPLIANCE` và tráo cặp `schoolId`/`contractId`/`documentId`; runner dọn 4/4 database).

### Kiểm chứng cuối Phase 6 (T036–T040)

- **Rollout và giới hạn phạm vi**: Catalog chỉ cấp mặc định `supplier_relationship.view` cho `INGREDIENT_SUPPLIER_ADMIN` khi role được tạo mới. Các role hiện hữu giữ nguyên cấu hình cũ và cần operator có `role_permission.manage` tự cập nhật theo quy trình `GET` → gộp đầy đủ `permissionIds` đang giữ + `supplier_relationship.view` → `PUT /api/roles/:roleId/permissions` (replace-all, chỉ nhận permission `isActive = true`; không tự gỡ/bật permission inactive, không tự chạy bootstrap/seed hoặc ghi DB vận hành/Azure).
- **SC-006 (chưa đo)**: Yêu cầu đo tối thiểu 90% quản trị viên tìm được đúng trường và mở đúng tệp hợp đồng trong tối đa 1 phút trên luồng giao diện hoàn chỉnh; không xem frontend là task backend và không dùng kết quả API/unit để đánh dấu SC-006 đạt.
- **Review kiến trúc (T037)**: Đã đối chiếu 7 file `src/modules/supplier-school/*` và [supplier-schools-api.md](contracts/supplier-schools-api.md): validation strict Zod ở boundary, controller không import DTO, service xác lập scope/transaction `RepeatableRead` dùng chung `tx` và ánh xạ allowlist không spread record, repository giữ toàn bộ SQL/Prisma và `WHERE` scope, không bytes trong metadata, không lock/cache/write.

| Hạng mục            | Lệnh thực tế                                                 | Kết quả                                                                                                                     |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Quality gate        | `npm run validate`                                           | PASS (`eslint . --max-warnings=0`, `prettier --check .`, `tsc --noEmit`, `prisma generate + tsc`)                           |
| Unit toàn repo      | `npm run test:unit`                                          | 707/707 PASS, 0 skipped (gồm `tests/supplier-school.test.ts` 11/11 và `authorization.test.ts` 20/20)                        |
| Authorization/PG    | `npm run test:local:authorization`                           | `authorization.integration.test.ts` 57/57 PASS; `supplier-onboarding.integration.test.ts` 12/12 PASS; dọn 4/4 DB disposable |
| Spec gate (mục 8.5) | `npm run spec:check` (working-tree snapshot so `origin/dev`) | PASSED (`Spec specs/supplier-linked-schools/ hợp lệ cho branch feat/supplier-linked-schools.`)                              |
