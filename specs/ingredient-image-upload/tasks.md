# Tasks: Upload ảnh nguyên liệu và helper ảnh/tài liệu dùng chung

**Input**: `specs/ingredient-image-upload/` — [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [API contract](contracts/ingredient-upload-api.md), [helper contract](contracts/upload-helper.md), [quickstart.md](quickstart.md).

**Prerequisites**: Ba quyết định clarify đã ghi nhận; không còn câu hỏi chặn triển khai. Runtime Node24.22.1/npm11/CommonJS theo repository. Không sửa schema, seed, onboarding semantics hoặc tạo API tài liệu mới.

**Tests**: Có task kiểm thử vì spec SC-001–SC-009 yêu cầu kiểm chứng nội dung, phân quyền, partial results, đồng thời và regression. Viết case trước phần triển khai tương ứng; xác nhận lỗi thể hiện hành vi còn thiếu, không cố tạo lỗi giả khi hành vi đã đạt. Dùng Node test runner, transport/clock giả, không Cloudinary thật trong test tự động.

**Organization**: Sáu phase; ba phase user story theo ưu tiên P1/P1/P2. Foundation giữ các kiểm tra an toàn cần dùng từ đầu, không đợi US2 mới bổ sung phân quyền cơ bản. US3 tận dụng core đã xây cho ảnh để hoàn thiện hai hàm tài liệu.

## Format: `[ID] [P?] [Story?] Description`

- Mỗi task có checkbox, ID tuần tự, đường dẫn file và nhãn story khi thuộc phase story.
- `[P]` chỉ cho phép làm song song với task độc lập ở cùng wave sau khi prerequisite được nêu đã xong; không có nghĩa mọi task `[P]` được chạy cùng lúc.
- Task đụng cùng file luôn theo thứ tự, kể cả giữa hai story. Bảng ownership và ví dụ bên dưới không cho phép hai người cùng sửa một file.
- File path tính từ repository root. Không commit `.specify/feature.json`, output sinh tự động hoặc credential.

## Phase 1: Setup — chuẩn bị triển khai

**Goal**: Chuẩn bị đúng nhánh, dependency và fixture; chưa gọi Cloudinary hoặc thay đổi DB.

- [x] T001 Xác minh worktree, tạo hoặc dùng nhánh `feat/ingredient-image-upload` từ dev mà không làm mất thay đổi hiện có; cập nhật thông tin nhánh thực tế trong `specs/ingredient-image-upload/spec.md` và `specs/ingredient-image-upload/plan.md`, giữ nguyên tên spec không số.
- [x] T002 Thêm Sharp0.35.5 vào `package.json` và `package-lock.json`, cài theo runtime hiện tại và xác nhận import CommonJS/native decoder hoạt động; giữ phiên bản Cloudinary/Multer đã có, không đổi runtime hoặc cài test framework.
- [ ] T003 Tạo fixture factory dùng chung ở `tests/helpers/upload-fixtures.ts` cho JPEG/PNG/WebP giải mã được, PDF nhận diện đúng định dạng, ảnh hỏng/MIME giả/multiframe hỏng và tệp hợp lệ đúng5MiB; không dùng vài byte signature thay ảnh hợp lệ, không commit output sinh vào `src/generated/`.

**Checkpoint**: Dependency và fixture sẵn sàng; không có kết nối Cloudinary thật hoặc mutation DB.

## Phase 2: Foundational — core chung chặn các story

**Goal**: Có kiểu, preflight, transport và điểm kiểm quyền đủ để triển khai các story mà không sao chép logic.

- [x] T004 Định nghĩa `UploadFile`, trusted `UploadContext`, `ImageAsset`, `DocumentAsset` và union `UploadItemResult<T>` theo data-model trong `src/utils/cloudinary-upload.types.ts`; index0-based, mã lỗi allowlist, tách success asset/failed error và không import Express/DTO/Prisma.
- [x] T005 Tạo các case nền trong `tests/cloudinary-upload.test.ts` cho buffer-size/count/context, MIME/decoder, config preflight, options Cloudinary, thứ tự result và transport giả; dùng fixture T003, xác nhận lỗi ban đầu do phần triển khai chưa có.
- [x] T006 [P] Xây validator chung/count/context và validator ảnh ở `src/utils/upload-file-validation.ts`:1..5MiB, size=buffer.length, JPEG/PNG/WebP, MIME/chữ ký khớp, Sharp metadata+pixel decode nghiêm ngặt cho mọi frame được hỗ trợ; prevalidate tuần tự toàn lượt, không đổi bytes hoặc tự thêm giới hạn pixel nghiệp vụ (sau T004–T005).
- [x] T007 [P] Tạo Cloudinary adapter có factory/transport injection trong `src/utils/cloudinary-client.ts`: đọc/kiểm ba biến cấu hình tại thời điểm dùng, snapshot credentials theo lượt, truyền credentials theo call không sửa global config, upload_stream, overwrite=false, publicId UUID theo scope; chuẩn hóa lỗi và allowlist response cơ bản (sau T004–T005).
- [x] T008 Xây core/factory chung trong `src/utils/cloudinary-upload.ts` dùng T006–T007: mọi tệp/context/config được kiểm trước network; hai worker tối đa mỗi lượt, giữ thứ tự index, bắt lỗi từng tệp, tiếp tục khi lỗi, giữ thành công và không auto retry/destroy; single throw lỗi an toàn, many trả đủ result dù tất cả failed.
- [x] T009 [P] Mở `actor(id, tx?)` trong `src/modules/ingredient/ingredient.repository.ts` để upload có thể đọc actor qua Prisma client chung khi không có transaction; giữ các caller ghi truyền cùng tx và reuse supplierStatus có ownership scope, không đưa truy vấn vào service (sau T004–T005).
- [x] T010 Thêm phương thức kiểm quyền upload trong `src/modules/ingredient/ingredient.service.ts`: reuse ingredientManagementScope và supplier ACTIVE cho guard trước multipart; cung cấp bước nạp lại actor/quyền/supplier, so supplierId với principal ban đầu trước helper; không dùng write()/Serializable retry hay giữ lock khi network (sau T009).
- [x] T011 [P] Tạo single/array middleware ở `src/middlewares/ingredient-upload.middleware.ts` với memoryStorage, đúng field image/images, files1/5, fields0, parser fileSize=5MiB+1 và parts=maxFiles+1, từ chối nonmultipart và map lỗi tiếng Việt400/413; strict validator sau parse vẫn giữ nghiệp vụ<=5MiB, không đổi parser global (sau T004–T005).
- [x] T012 Chạy các case core hiện có ở `tests/cloudinary-upload.test.ts`, xác nhận các task T006–T011 không làm đổi onboarding/global config, ghi kết quả nền và giới hạn chưa kiểm chứng vào `specs/ingredient-image-upload/quickstart.md` trước khi tích hợp story.

**Checkpoint**: Core và guard/parser sẵn sàng; không tạo API chưa có kiểm quyền. `[P]` trong phase này chỉ chạy sau T004–T005, theo thứ tự chi tiết ở Dependencies.

## Phase 3: US1 — Tải ảnh để thêm hoặc sửa nguyên liệu (Priority: P1)

**Goal**: Quản trị đúng quyền upload một hoặc1–5ảnh, dùng URL trong create/update JSON hiện tại và đọc lại đúng dữ liệu.

**Independent Test**: Dùng router/service cùng fake storage và persistence fixture; single201, many200, lưu coverImage/ba imageDescription đúng thứ tự; upload không tự tạo/sửa nguyên liệu và URL vẫn dùng lại được sau một lần lưu lỗi.

### Tests cho US1

- [x] T013 [P] [US1] Viết contract/happy-path multipart tests ở `tests/ingredient-upload.test.ts` cho hai route, single201, many200/results, URL/metadata allowlist và upload trước khi có ingredientId; inject auth/repository/transport, không gọi storage thật (sau Phase2).
- [x] T014 [P] [US1] Bổ sung regression nhận URL upload ở `tests/ingredient-management.test.ts` và điều chỉnh typed ingredient-service fixture nếu bị ảnh hưởng trong `tests/modules.test.ts`; kiểm coverImage/imageDescription, giữ thứ tự và semantics omitted/null/[] mà không giảm tổng ảnh lưu xuống5 (sau Phase2).

### Implementation cho US1

- [x] T015 [P] [US1] Thêm strict schemas/validator trong `src/modules/ingredient/ingredient.validation.ts` cho query/body rỗng và cấu trúc file chuẩn hóa từ Multer; chọn đúng buffer/size/mimeType/originalName thay vì parse nguyên Multer object, giữ schema create/update cũ và lỗi field path tiếng Việt (sau T013–T014).
- [x] T016 [US1] Thêm hai Request DTO suy ra bằng z.infer/type-only schema import trong `src/modules/ingredient/ingredient.request.dto.ts`; không tự viết lại cấu trúc input, không import DTO từ controller/validation/repository (sau T015).
- [x] T017 [P] [US1] Bổ sung single image response và batch results union ở `src/modules/ingredient/ingredient.response.dto.ts` theo API contract; chỉ dùng types/interfaces JSON-safe, không dùng raw SDK response hoặc Request DTO (sau T013–T014).
- [x] T018 [P] [US1] Export `uploadImage` và `uploadImages` cùng phương thức tương ứng trên factory trong `src/utils/cloudinary-upload.ts`, dùng core T008 và image/upload policy, giữ độc lập module nguyên liệu (sau T013–T014).
- [x] T019 [US1] Thêm upload methods vào `src/modules/ingredient/ingredient.service.ts` và tham số uploader cuối có default trong factory; gọi lại bước kiểm actor/supplier của T010, tạo namespace ingredients/ownerId từ scope và map allowlist sang Response DTO, không ghi DB hoặc trả record transport trực tiếp (sau T016–T018).
- [x] T020 [US1] Thêm authorizeUpload và hai action trong `src/modules/ingredient/ingredient.controller.ts`: guard gọi service trước parser, action gọi validator/principal/service rồi sendSuccess với single201 hoặc many200; không import Request/Response DTO (sau T019).
- [x] T021 [US1] Đăng ký POST `/management/upload-image` và `/management/upload-images` ở `src/modules/ingredient/ingredient.routes.ts` theo thứ tự auth/scope -> ACTIVE supplier guard -> multipart -> controller; giữ global CSRF/limiter và router registration hiện có (sau T011, T020).
- [ ] T022 [US1] Hoàn thiện/chạy hành trình trong `tests/ingredient-upload.test.ts`: upload rồi create/update/read qua fixture, chưa lưu thì dữ liệu cũ giữ nguyên, lưu lỗi vẫn dùng lại URL và spy không có model write từ upload; xác nhận các tests T013–T014 đạt (sau T021).

**Checkpoint**: US1 tạo được giá trị nghiệp vụ độc lập trên nền phân quyền/validation đã có. Chưa coi full feature hoàn tất khi chưa kiểm US2/US3.

## Phase 4: US2 — Chặn upload không hợp lệ và báo lỗi rõ ràng (Priority: P1)

**Goal**: Chứng minh/củng cố các biên kiểm tra, quyền và lỗi storage; không để lỗi chung bị nhầm với partial result.

**Independent Test**: Test với transport/clock giả, multipart thật; sai quyền/sai tệp không gọi network, đúng5MiB và5tệp được nhận, lỗi giữa lượt trả đúng từng status, single error503 và many xử lý xong200.

### Tests cho US2

- [ ] T023 [P] [US2] Mở rộng `tests/cloudinary-upload.test.ts` với empty/>5MiB/buffer mismatch, fake MIME/truncated/later-frame lỗi, input invalid ở cuối lượt không gửi tệp nào, thiếu config/placeholder, deadline/stream error/late callback, existing:true và response sai scope/type/URL/metadata; kiểm không rò secret (sau US1).
- [ ] T024 [P] [US2] Mở rộng `tests/ingredient-upload.test.ts` cho401/403, staff kể cả có grant, System, supplier INACTIVE/membership sai, đổi scope/thu hồi quyền trong lúc đọc body, CSRF/origin, wrong field/query/text/nonmultipart/count và biên đúng5MiB/5MiB+1/đúng5/sáu tệp; spy guard từ chối trước parser/transport (sau US1).

### Implementation và tích hợp cho US2

- [x] T025 [P] [US2] Hoàn thiện deadline30giây ngoài SDK inactivity timeout và response guard trong `src/utils/cloudinary-client.ts`: settle một lần/clear timer/late callback/stream error, best-effort đóng stream, kiểm expected publicId/resourceType/type, existing:true, HTTPS Cloudinary đúng cloud và metadata; chỉ phát safe error code, không retry/đảm bảo remote đã hủy (sau T023–T024).
- [x] T026 [P] [US2] Hoàn thiện chuẩn hóa lỗi parser trong `src/middlewares/ingredient-upload.middleware.ts` theo tests T024, giữ ngưỡng parser+1 với validation nghiệp vụ cứng để đúng5MiB/đúng5part không bị loại; không chuyển Multer/raw parser message tới client hoặc sửa middleware onboarding (sau T023–T024).
- [x] T027 [P] [US2] Củng cố error/scope paths trong `src/modules/ingredient/ingredient.service.ts` theo T024: DB reads qua repository/databaseOperation, actor nạp lại đúng role/permission/org, supplierId không đổi, không gọi helper khi mất quyền; giữ single503/batch per-item và không retry upload theo DB transaction (sau T023–T024).
- [ ] T028 [US2] Hoàn thiện assertions trong `tests/ingredient-upload.test.ts` cho invalidinput/config là lỗi chung, single upload lỗi503, lượt5tệp/2lỗi và all-failed đều200 với đủ index/status; metadata safe và dữ liệu nguyên liệu không đổi, global limiter/CSRF vẫn được áp dụng (sau T025–T027).
- [x] T029 [P] [US2] Thêm scenario current-role/current-permission/tenant/supplier-status vào `tests/authorization.integration.test.ts`, reuse fixture disposable local và fake upload adapter; chọn DI hẹp ở router/service để không thêm app plumbing hoặc Cloudinary thật, giữ nguyên fixture/case hiện có (có thể chuẩn bị sau US1, chạy sau T028).
- [x] T030 [US2] Chạy nhóm helper/HTTP/ingredient regression hiện có bằng Node test runner, ghi kết quả hoặc prerequisite thực tế ở `specs/ingredient-image-upload/quickstart.md`; sửa đúng file sở hữu nếu test phát hiện hành vi chưa đạt, không đổi contract chỉ để bỏ case lỗi (sau T023–T029; DB integration thực thi ở T043).

**Checkpoint**: US1+US2 là MVP ảnh nguyên liệu có kiểm chứng an toàn; giới hạn/errors được chứng minh bằng test, không chỉ kiểm code.

## Phase 5: US3 — Dùng lại khả năng upload ảnh và tài liệu (Priority: P2)

**Goal**: Hoàn thiện bốn hàm dùng chung, gồm hai hàm tài liệu PDF/PNG/JPEG riêng tư, không thêm API tài liệu hoặc đổi onboarding.

**Independent Test**: Một caller kiểm thử không có ingredientId dùng cả bốn hàm; single1/many1..5, trộn các định dạng tài liệu được hỗ trợ, partial failures giữ thứ tự/thành công và không đụng global config/onboarding.

### Tests cho US3

- [x] T031 [US3] Viết case tài liệu và caller độc lập trong `tests/cloudinary-upload.test.ts`: PDF/PNG/JPEG, từ chối WebP/DOCX/XLSX, single thiếu/thừa, many0/1/5/6, trộn định dạng hợp lệ, raw/authenticated và không public URL/required dimensions; dùng namespace ngoài ingredients để chứng minh tái sử dụng (sau US2).

### Implementation cho US3

- [x] T032 [P] [US3] Thêm validator tài liệu trong `src/utils/upload-file-validation.ts`: MIME/chữ ký PDF và dùng lại decoder PNG/JPEG, dung lượng<=5MiB/size khớp, toàn lượt preflight; nêu đúng phạm vi nhận diện PDF, không hứa parse toàn tài liệu hay đổi onboarding validator (sau T031).
- [x] T033 [P] [US3] Bổ sung raw/authenticated policy, publicId có đuôi pdf/png/jpg, guard định danh/bytes và allowlist private DocumentAsset trong `src/utils/cloudinary-client.ts`; fileName làm sạch, không public URL/signature/secret và không yêu cầu width/height của tài liệu (sau T031).
- [x] T034 [US3] Export `uploadDocument`, `uploadDocuments` và hoàn thiện factory đủ bốn hàm trong `src/utils/cloudinary-upload.ts`, reuse pipeline/two-worker/results/config, single throw và many per-file; không tạo document HTTP route hoặc quan hệ tài liệu-nguyên liệu (sau T032–T033).
- [ ] T035 [US3] Mở rộng/chạy `tests/cloudinary-upload.test.ts` cho cả hai nhóm many:5tệp/2lỗi, all-failed, completion đảo, retry riêng lỗi,10upload cùng tên ở2owner, max2worker/lượt và không destroy/auto retry/ghi đè; kiểm các kết quả độc lập namespace, bytes gốc không bị encode lại (sau T034).
- [ ] T036 [P] [US3] Chạy và bổ sung regression cần thiết ở `tests/onboarding.test.ts` cho raw/authenticated,20tệp, private download60giây và cleanup cũ; chứng minh upload helper mới không thay global config/onboarding behavior, không sửa fixture signature cũ chỉ vì validator mới nghiêm ngặt (sau T034, độc lập file với T035).
- [ ] T037 [US3] Kiểm chứng bốn hàm qua nhóm tests helper/onboarding và cập nhật trạng thái thật trong `specs/ingredient-image-upload/quickstart.md`; xác nhận không có Prisma model/migration, document API hoặc thao tác xóa tệp được thêm ngoài phạm vi (sau T035–T036).

**Checkpoint**: Hoàn thành cả ba story; bốn hàm có contract và test tương ứng, onboarding giữ nguyên.

## Phase 6: Polish & Cross-Cutting Concerns

**Goal**: Đồng bộ tài liệu/test registration, chạy quality gates và ghi rõ các kiểm tra đã/chưa thực hiện.

- [x] T038 Thêm `tests/cloudinary-upload.test.ts` và `tests/ingredient-upload.test.ts` vào script test:unit trong `package.json`, giữ toàn bộ test cũ; kiểm lock nhất quán với Sharp và không đăng ký DB integration vào nhóm infrastructure-free.
- [x] T039 [P] Cập nhật ma trận endpoint/quyền/input/result ở `docs/AUTHORIZATION.md` và ownership/endpoint mapping ở `src/modules/README.md` cho hai route ảnh, single201/many200 và partial status; giữ tương thích create/update và không công bố API tài liệu chưa xây.
- [x] T040 [P] Cập nhật chú thích placeholder Cloudinary trong `.env.example` và hướng dẫn vận hành upload/Sharp ở `README.md`; ghi rõ cấu hình chỉ cần khi dùng upload, native decoder/runtime và API smoke có CSRF, không ghi credential hoặc bật cấu hình Cloudinary từ code.
- [x] T041 Đồng bộ kết quả triển khai thực tế với `specs/ingredient-image-upload/plan.md`, `specs/ingredient-image-upload/contracts/ingredient-upload-api.md`, `specs/ingredient-image-upload/contracts/upload-helper.md` và `specs/ingredient-image-upload/checklists/requirements.md`; sửa ghi chú checklist cũ về số FR/SC/số tệp cho khớp20FR/9SC/bốn hàm, không mở rộng yêu cầu đã chốt.
- [x] T042 Chạy `npm run test:unit` và `npm run validate` sau T038–T041, xác minh targeted helper/HTTP/onboarding regressions đạt; ghi lệnh/runtime/số test/lỗi thực tế vào `specs/ingredient-image-upload/quickstart.md`, không báo pass cho kiểm tra chưa chạy.
- [x] T043 Xác minh prerequisite của `tests/authorization.integration.test.ts`, chạy `npm run test:authorization` chỉ khi đã chọn và được phép dùng PostgreSQL local disposable theo repository; ghi đã chạy hoặc prerequisite đang thiếu vào `specs/ingredient-image-upload/quickstart.md`, không dùng DB thành viên/Azure, không tự seed/migrate DB thật hoặc upload Cloudinary thật.
- [ ] T044 Rà soát toàn bộ FR/SC và file diff, cập nhật trạng thái/bằng chứng trong `specs/ingredient-image-upload/spec.md`, `specs/ingredient-image-upload/tasks.md` và `specs/ingredient-image-upload/quickstart.md`; kiểm git diff --check, không có generated output/secret/migration ngoài phạm vi, giữ rõ kiểm tra integration chưa chạy nếu có.

**Checkpoint**: Các task code/test/docs đã hoàn thành, quality gates thực tế được ghi nhận; chỉ đánh dấu task hoàn tất khi tiêu chí của task đã thực sự đạt. T043 có thể hoàn tất phần đánh giá prerequisite và ghi chưa chạy, nhưng không được tuyên bố integration pass nếu hạ tầng chưa đủ.

## Dependencies & Execution Order

### Phase và story dependencies

```text
Setup T001–T003
  -> Foundation T004–T012
    -> US1 T013–T022 (P1, API ảnh và lưu tham chiếu)
      -> US2 T023–T030 (P1, biên lỗi/quyền)
        -> US3 T031–T037 (P2, bốn hàm và private documents)
          -> Polish T038–T044
```

US1 dùng các guard/validation cơ bản từ foundation nên có thể kiểm thử riêng với fake transport. US2 kiểm chứng/củng cố lỗi của pipeline US1; đây là dependency có chủ đích để không sao chép source. US3 cần core chung đã ổn định của US1/US2, không phụ thuộc nghiệp vụ tài liệu ngoài dự án. Mỗi story có bộ tiêu chí nghiệm thu độc lập dù chia sẻ prerequisite.

### File-level ordering bắt buộc

| File/nhóm                                                   | Thứ tự task sửa file                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| package.json / package-lock.json                            | T002 -> T038                                                     |
| src/utils/cloudinary-upload.types.ts                        | T004, sau đó giữ interface ổn định hoặc handoff rõ               |
| tests/cloudinary-upload.test.ts                             | T005 -> T023 -> T031 -> T035                                     |
| src/utils/upload-file-validation.ts                         | T006 -> T032                                                     |
| src/utils/cloudinary-client.ts                              | T007 -> T025 -> T033                                             |
| src/utils/cloudinary-upload.ts                              | T008 -> T018 -> T034                                             |
| ingredient.repository.ts                                    | T009                                                             |
| ingredient.service.ts                                       | T010 -> T019 -> T027                                             |
| ingredient-upload.middleware.ts                             | T011 -> T026                                                     |
| tests/ingredient-upload.test.ts                             | T013 -> T022 -> T024 -> T028                                     |
| tests/ingredient-management.test.ts / tests/modules.test.ts | T014                                                             |
| ingredient.validation.ts / request.dto.ts                   | T015 -> T016                                                     |
| ingredient.response.dto.ts                                  | T017                                                             |
| ingredient.controller.ts / routes.ts                        | T020 -> T021                                                     |
| tests/authorization.integration.test.ts                     | T029 -> chạy có điều kiện T043                                   |
| tests/onboarding.test.ts                                    | T036                                                             |
| quickstart.md và trạng thái spec/tasks                      | Một người tích hợp cập nhật T012/T030/T037/T042–T044 theo thứ tự |

Các file ingredient.* ở bảng trên nằm trong `src/modules/ingredient/`; middleware nằm trong `src/middlewares/`. Không chia hai task cùng file cho hai người đang chạy.

### Parallel opportunities theo wave

- Sau T004–T005: T006, T007, T009 và T011 khác file; T008 chờ T006–T007, T010 chờ T009. T012 chờ toàn foundation.
- US1: T013 và T014 có thể viết test song song; sau đó T015, T017, T018 khác file. T016 chờ T015; T019 chờ T016–T018; controller/router/integration chạy nối tiếp.
- US2: T023 và T024 độc lập file; sau đó T025/T026/T027 độc lập source. T029 có thể chuẩn bị từ sau US1 nếu tests integration không bị task khác sửa; không chạy test DB khi chưa có prerequisite.
- US3: T031 trước triển khai; T032 và T033 độc lập; T034 chờ cả hai; T035 và T036 độc lập file sau T034.
- Polish: T039 và T040 độc lập; T038 chỉ một người sửa package. T041 phải kết thúc trước T042 để tránh format check đọc tài liệu đang ghi; T042/T043/T044 tuần tự do cùng ghi validation log.

## Parallel Examples per Story

### US1

Sau foundation, giao riêng T013 (`tests/ingredient-upload.test.ts`) và T014 (`tests/ingredient-management.test.ts`, `tests/modules.test.ts`). Khi tests đã có, một người làm T015–T016 (validation/request DTO), một người T017 (response DTO), một người T018 (image facade). Handoff trước T019; không ai khác sửa service lúc tích hợp.

### US2

Sau T023–T024, tách T025 (`src/utils/cloudinary-client.ts`), T026 (`src/middlewares/ingredient-upload.middleware.ts`) và T027 (`src/modules/ingredient/ingredient.service.ts`). Chờ cả ba hoàn thành rồi giao duy nhất một người tích hợp assertions T028.

### US3

Sau T031, tách T032 (`src/utils/upload-file-validation.ts`) và T033 (`src/utils/cloudinary-client.ts`). Hợp nhất qua T034, sau đó có thể tách T035 (`tests/cloudinary-upload.test.ts`) và T036 (`tests/onboarding.test.ts`).

Đây là phương án chia việc nếu có nhiều người/agent; task generation không tự khởi chạy agent triển khai hoặc cho phép sửa trùng file.

## Requirement Coverage

| Yêu cầu                                                                         | Task chính                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------- |
| FR-001–FR-002 — quyền/scope trước xử lý                                         | T009–T010, T019–T021, T024, T027, T029            |
| FR-003/FR-008/FR-013/FR-014 — upload trước lưu, URL tương thích, không mutation | T014–T022, T028                                   |
| FR-004/FR-005/FR-017 — count/input/nội dung/giới hạn                            | T003, T005–T006, T011, T015–T016, T023–T026, T032 |
| FR-006/FR-007/FR-009 — storage/metadata/no overwrite                            | T004, T007–T008, T017–T019, T025, T033, T035      |
| FR-010/FR-011 — bốn hàm và reusable boundaries                                  | T004, T008, T018, T031–T037                       |
| FR-012/FR-019 — lỗi chung và từng tệp                                           | T005, T007–T008, T023–T030, T035                  |
| FR-015/FR-020 — public image/private docs/onboarding                            | T007, T025, T031–T036                             |
| FR-016 — limiter và ngoài phạm vi                                               | T021, T028, T037, T039–T044                       |
| SC-001/SC-002 — upload và lưu/read                                              | T013–T014, T018–T022                              |
| SC-003/SC-005 — input/auth/failure safe                                         | T023–T030, T042–T043                              |
| SC-004 —10upload/2supplier không ghi đè                                         | T035                                              |
| SC-006–SC-009 — bốn hàm/count/docs/partial/retry                                | T031–T037, T042                                   |

## Implementation Strategy

### MVP First

Hoàn thành Setup + Foundation + US1 + US2 để có upload ảnh nguyên liệu có kiểm chứng phân quyền/validation/errors. US1 là hành trình nghiệp vụ nhỏ nhất có thể demo sau foundation; MVP đưa vào sử dụng nên bao gồm US2 vì cùng ưu tiênP1. Không công bố đã hoàn thành toàn bộ yêu cầu bốn hàm trước US3.

### Incremental Delivery

1. T001–T012: core/transport/validation/guard, test không mạng.
2. T013–T022: demo thêm/sửa nguyên liệu bằng ảnh từ thiết bị.
3. T023–T030: hoàn tất negative/error/authorization acceptance cho MVP ảnh.
4. T031–T037: hoàn thiện helper tài liệu và tái sử dụng đủ bốn hàm.
5. T038–T044: test registration/docs/quality gate/evidence, ghi rõ prerequisite chưa có.

Không push, deploy, seed, migration hay upload thật chỉ để hoàn thành checklist. Smoke tài nguyên thật theo quickstart là thao tác người vận hành chủ động khi đã có cấu hình và phạm vi cho phép.

## Hooks và trạng thái tạo task

Đã kiểm tra `.specify/extensions.yml` trước và sau sinh tasks: không tồn tại, không có hook cần thực thi. File này chỉ phân rã công việc; mọi checkbox còn chưa đánh dấu, chưa cài dependency, sửa code, chạy DB hoặc upload tài nguyên thật ở bước tasks.
