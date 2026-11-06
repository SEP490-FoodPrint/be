# Quickstart: Kiểm chứng registrationID

**Plan**: [plan.md](plan.md)  
**Contracts**: [contracts/registration-id.md](contracts/registration-id.md)  
**Data model**: [data-model.md](data-model.md)

Các file test và script trong hướng dẫn này đã được triển khai. Kết quả thực chạy được ghi ở cuối tài liệu; mọi kiểm thử ghi dữ liệu dùng PostgreSQL/Redis tạm riêng, không dùng cấu hình database remote của dự án.

## 1. Điều kiện

- Node.js theo .nvmrc, npm 11 và dependencies từ lockfile.
- Có tasks.md đã đối chiếu với spec/plan trước khi viết code.
- Đối với integration: PostgreSQL local được chọn rõ ràng, có quyền tạo database disposable; URL phải qua assertLocalMigrationTarget, không phải Azure hoặc database thành viên.
- MIGRATION_TEST_DATABASE_URL trỏ database test mới có tên theo harness `foodprint_migration_test` hoặc `foodprint_migration_test_<suffix>`; test migration yêu cầu chưa có schema foodprint, không tự reset/drop schema có sẵn.
- Test integration cấp mã tạo database con có tên ngẫu nhiên trong instance đã chọn; không sửa dữ liệu database thành viên và chỉ dọn database do chính lượt test tạo.
- Có sự cho phép thực hiện kiểm thử/migration trên môi trường disposable đó. Lệnh plan không tự cấp quyền ghi DB.
- Test dùng storage stub có phạm vi riêng, không upload tài liệu thật lên cloud. Chuẩn bị tài khoản/quyền làm fixture chỉ trong database disposable, không chạy bootstrap/seed trên database thật.

Chạy lệnh từ repository root. Không commit .env, URL hoặc credential.

## 2. Kiểm tra không cần cơ sở dữ liệu

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run build
npm run test:unit
```

Các lệnh Prisma trên validate/generate schema và client, không deploy migration. Dùng DATABASE_URL local hợp lệ về cấu hình của riêng môi trường; không cần kết nối để validate/generate.

Chạy riêng các test liên quan sau khi đã bổ sung test formatter:

```bash
npm exec --no -- tsx --test tests/registration-id.test.ts tests/modules.test.ts tests/onboarding.test.ts tests/registration-review.test.ts tests/auth-session.test.ts
```

Kết quả mong đợi:

- Định dạng đúng tại 1, 9, 10, 99999, 100000 và giá trị lớn hơn Number.MAX_SAFE_INTEGER.
- Mapping JSON không có bigint, registrationNumber hoặc trường nhạy cảm; ngày là ISO/null.
- Edit/resubmit không cấp mã mới; validation từ chối tự gán mã ở các object JSON/multipart strict.
- reviewVersion của nội dung không đổi giữ nguyên khi chỉ bổ sung số; thay liên hệ, nội dung hoặc tài liệu vẫn thay hash.
- Session fixtures có summary khác null để kiểm chứng login/refresh/me/PATCH me; null vẫn là null.
- Danh sách dùng chung search cho mã đầy đủ và tên người nộp: trim, chuỗi trắng bỏ lọc, tên contains không phân biệt hoa/thường và wildcard literal. Parser nhận mã chuẩn không phân biệt hoa/thường, bigint lớn không mất độ chính xác; từ khóa khác chỉ tìm tên. No match/trang sau trả rỗng; search sai kiểu/quá 255 ký tự và người thiếu quyền bị chặn. Chi tiết vẫn nhận UUID.

## 3. Migration trên disposable PostgreSQL

Operator cấu hình MIGRATION_TEST_DATABASE_URL cho database local test mới theo điều kiện trên. Không dùng DATABASE_URL của môi trường triển khai làm giá trị dự phòng.

```bash
npm run test:migrations
```

Kết quả mong đợi:

1. Có thể dựng toàn bộ lịch sử trên database rỗng; số của hồ sơ đầu tiên là 1.
2. Fixture upgrade ở database riêng được dựng đến trạng thái trước migration mới rồi thêm hồ sơ cũ, sau đó áp migration một lần.
3. Dữ liệu gồm SCHOOL/SUPPLIER, PENDING/APPROVED/REJECTED và submitted_at trùng; số được gán theo submitted_at ASC, id ASC.
4. Snapshot mọi cột cũ trước/sau giống nhau, kể cả UUID, timestamps, profileData, tài liệu, quan hệ và outbox FK.
5. Hồ sơ mới tiếp theo nhận số lớn hơn max cũ; không có null/trùng/số không dương.
6. Kiểm tra catalog xác nhận unique, CHECK dương, default, ownership, CACHE 1 và NO CYCLE của sequence.
7. Giữ kiểm tra Prisma migrate diff hiện có: không có schema drift. CHECK và cấu hình sequence cần kiểm tra riêng vì schema diff không bao phủ toàn bộ quy tắc PostgreSQL.

Không chạy migration mới lên schema đã có cột rồi giả định đó là kiểm thử nâng cấp. Không sửa migration đã applied hoặc dùng reset/resolve để vượt lỗi.

## 4. Integration và đồng thời

Script `test:registration-id` chạy tests/registration-id.integration.test.ts và đã được đăng ký vào job PostgreSQL trong CI. Harness dùng instance local đã chọn và luôn tạo database con disposable riêng.

```bash
npm run test:registration-id
npm run test:authorization
```

Kết quả mong đợi:

- 100 người nộp khác nhau, đủ hai loại hồ sơ, gửi mới đồng thời; mọi hồ sơ lưu thành công có mã riêng, không thiếu mã.
- Việc chuẩn bị fixture và cấu hình HTTP tests không để rate limiter/upload ngoài phạm vi che khuất kiểm thử cấp số; không thay policy runtime.
- Kiểm tra rollback sau insert đã dùng số: không còn hồ sơ của transaction thất bại, số đó không được tái dùng.
- Trong database test riêng, kiểm tra mốc 99999 → 100000; không đặt/reset sequence của database thực.
- Hai người nộp khác nhau dùng chung dãy số; chỉnh sửa, từ chối, gửi lại và phê duyệt cùng hồ sơ giữ mã.
- Danh sách/chi tiết/hồ sơ của mình/summary session trả cùng mã.
- Thiếu quyền hoặc xem hồ sơ ngoài phạm vi tiếp tục bị chặn; approve/reject đồng thời giữ atomicity và outbox hiện tại.

Mocks trong unit không thay thế kiểm chứng sequence/transaction bằng PostgreSQL thật.

## 5. Kiểm chứng HTTP với ứng dụng local đã triển khai migration

Dùng các request/fixture đang có trong integration thay vì tạo dữ liệu trên môi trường thật.

1. Đăng nhập người nộp hợp lệ và nộp hồ sơ; POST onboarding vẫn trả 201, data có UUID id và registrationID.
2. GET onboarding trả cùng mã; GET me và refresh/login có cùng mã trong registrationRequest.
3. Đăng nhập quản trị viên có quyền view; GET registration-requests và GET chi tiết theo UUID cho cùng mã. Chuyển trang không đổi mã hoặc thứ tự hiện hành.
   Thử `GET /api/registration-requests?search=FP-REG-00001&page=1&limit=5`, `search=%20fp-reg-00001%20` và `search=nguy%E1%BB%85n`; kết quả khớp mã chính xác hoặc chứa từ khóa trong tên người nộp. Chuyển trang trên các kết quả tên, giữ hasNext. Không dùng mã thay UUID khi gọi chi tiết. Từ khóa không khớp mã/tên cho 200/rỗng; sai kiểu hoặc quá 255 ký tự cho 400 ở field search.
4. Gửi registrationID tự chọn ở root JSON, outer multipart, JSON profile, certification và retained document; mỗi trường hợp nhận 400 trước upload cloud/ghi.
5. Thực hiện edit → reject → resubmit → approve hợp lệ; đối chiếu mã, trạng thái, reviewVersion và phản hồi theo [contract](contracts/registration-id.md).
6. Gửi mã FP-REG vào UUID param hoặc dùng tài khoản thiếu quyền; nhận lỗi hiện hành và không mở rộng phạm vi truy cập.
7. Giữ các route tài liệu chỉ trả URL/expiresIn và đường dẫn nội bộ dùng UUID.

Thay đổi hiển thị trên frontend được nghiệm thu ở ứng dụng quản trị tương ứng sau khi backend cung cấp trường; không coi backend đã trả field là giao diện đã được sửa.

## 6. Quality gate và ghi kết quả

```bash
npm run validate
npm run test:unit
```

Sau khi các thay đổi được commit cùng spec/plan/tasks, chạy spec gate với base/head theo docs/SPEC_KIT_GUIDE.md. Chạy migration/authorization/concurrency trong CI với PostgreSQL disposable như các bước trên; quality jobs không nhận Azure credentials.

Ghi rõ từng lệnh PASS/FAIL, test bị bỏ qua và lý do thiếu môi trường. Nếu test DB bị chặn thì không kết luận đã kiểm chứng backfill, uniqueness hoặc concurrency.

## 7. Triển khai sau nghiệm thu

Review migration → áp migration/backfill qua quy trình được phép → backend mới → frontend dùng mã. Dự kiến khoảng khóa bảng và kiểm tra quyền sequence runtime. Nếu rollback ứng dụng, giữ toàn bộ số/mã đã cấp; không rollback schema, reset sequence hoặc đánh số lại.

## 8. Kết quả thực thi tính năng

- Node 24.22.1, npm 11.19.1, Prisma 7.10.1.
- Prisma validate/generate: PASS. npm run validate (lint, format, typecheck, build): PASS.
- npm run test:unit: 172/172 PASS, gồm HTTP JSON/multipart injection và summary session khác null.
- Migration suite: 9/9 PASS, gồm 3 hồ sơ cũ đủ hai loại/ba trạng thái, timestamp đến microsecond và UUID tie-break; snapshot mọi cột cũ giữ nguyên, catalog và schema drift đạt.
- Registration integration: 5/5 PASS. Có 100 người nộp logic đồng thời với retry client giới hạn khi nhận 503 do Serializable; đủ 100 hồ sơ riêng, không thiếu/trùng mã. Giữ nguyên isolation và retry của runtime. Kiểm chứng thêm rollback không tái dùng số, mốc 100000, writer cũ, vòng đời và summary.
- Authorization integration: 33/33 PASS; supplier integration: 7/7 PASS, trên PostgreSQL 18 và Redis 7 tạm. Tổng các suite integration/migration: 54/54 PASS.
- Spec gate working-tree preflight: PASS trên branch feat/001-add-registration-id; không thay thế kết quả CI cho commit/PR sau này. git diff --check: PASS.
- Lượt kiểm chứng cuối: npm run validate PASS; registration integration 5/5 PASS sau khi siết allowlist outbox và projection user. Không còn task implementation/kiểm chứng bắt buộc chưa hoàn tất.
- Cấu hình .env của dự án và dữ liệu remote không được thay đổi. Migration production cần review/CD theo quy trình hiện hành.

## 9. Kết quả bổ sung tìm kiếm mã trong danh sách (lịch sử)

- Nhánh `fix/001-registration-code-search`: `GET /api/registration-requests?search=FP-REG-00001`; chi tiết và các thao tác/tài liệu tiếp tục dùng UUID.
- 7/7 kiểm thử registration PASS: normalization, validation nhiều trường, mã sau 99999/bigint lớn, no match/trang sau, scope, envelope và từ chối mã public ở đường dẫn chi tiết.
- `npm run validate`: PASS (lint, format, typecheck, build). `npm run test:unit`: 177/177 PASS.
- Spec gate working-tree preflight: PASS; `git diff --check`: PASS. Preflight không thay thế check CI cho commit/PR.
- Lượt này chỉ thêm bộ lọc trên cột/index hiện có; dùng kiểm thử unit/HTTP với reader giả lập, không chạy lại integration PostgreSQL/Redis, không tạo hoặc áp dụng migration và không thay cấu hình/dữ liệu hiện hữu.

## 10. Kết quả bổ sung tìm theo tên người nộp — 2026-11-07

- Nhánh `feat/001-registration-name-search`: query `search` tìm chính xác mã đầy đủ hoặc contains không phân biệt hoa/thường trong `applicantUser.fullName`; vẫn phân biệt dấu. Chi tiết/review/document giữ UUID.
- 12/12 targeted registration tests PASS, gồm parser mã/bigint lớn, tên đầy đủ/một phần, mode insensitive và escape literal, nhiều trang, no match, query sai kiểu/quá dài, quyền và error envelope.
- `npm run validate`: PASS (lint, format, typecheck, build). `npm run test:unit`: 188/188 PASS.
- Spec gate working-tree preflight: PASS; `git diff --check`: PASS. Preflight không thay thế check CI cho commit/PR.
- Chỉ kiểm chứng query và phản hồi bằng unit/HTTP với reader giả lập; không chạy lại integration PostgreSQL/Redis, không tạo hoặc áp dụng migration và không thay cấu hình/dữ liệu hiện hữu.
