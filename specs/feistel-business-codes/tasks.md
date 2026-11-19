---
description: "Task list for feistel-business-codes"
---

# Tasks: Mã nghiệp vụ FP thống nhất mã hóa bằng Feistel permutation

**Input**: Design documents from `specs/feistel-business-codes/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/business-code.md](contracts/business-code.md), [quickstart.md](quickstart.md)

**Tests**: Có. Spec đặt SC-001…SC-005 cần kiểm chứng và hiến chương yêu cầu test mới không cần hạ tầng nằm trong `npm run test:unit`.

**Organization**: Theo user story của spec. US2 (chức năng dùng chung) là nền tảng của mọi story nên phần lõi nằm ở Phase 2; Phase US2 chỉ còn phần hợp nhất parser/tìm kiếm mã cũ.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1, US2, US3 theo spec

## Quy ước chung cho mọi task

- Đọc `.specify/memory/constitution.md` (nguyên tắc I–VII) và `AGENTS.md` trước khi sửa code.
- Thông báo lỗi tiếng Việt; lỗi qua `HttpError` (`src/utils/http-error.ts`).
- Không chạy `db:migrate`, `db push`, backfill hoặc lệnh ghi DB khi chưa được người dùng cho phép cho tác vụ đó. Test tích hợp chỉ qua `npm run test:local:*`.
- Không sửa migration đã áp dụng; không hand-edit `src/generated/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Nhánh làm việc, cấu hình khóa runtime và khóa cho CI/test

- [x] T001 Tạo nhánh `refactor/feistel-business-codes` từ `dev` (git); xác nhận `.specify/feature.json` trỏ `specs/feistel-business-codes` và không commit file này
- [x] T002 [P] Thêm `BUSINESS_CODE_KEY=` (placeholder, comment: 64 ký tự hex, mỗi môi trường một khóa, không đổi sau khi phát hành mã) vào `.env.example` và `.env.test.example`
- [x] T003 [P] Thêm `readBusinessCodeKey(source = process.env): Buffer` vào `src/config/env.ts`: đọc `BUSINESS_CODE_KEY`, chấp nhận đúng 64 ký tự hex, trả Buffer 32 byte; thiếu/sai → ném `HttpError(503, "Không thể cấp mã nghiệp vụ. Vui lòng thử lại sau.")` và `console.error` thông báo cấu hình thiếu/sai **không** in giá trị khóa
- [x] T004 [P] Cấu hình khóa test: thêm `BUSINESS_CODE_KEY: <64 ký tự hex chỉ dùng cho CI>` vào `env` của mọi job chạy test trong `.github/workflows/ci.yml` (cạnh `JWT_SECRET`, dòng ~29 và ~105; không thêm vào job CD) và `process.env.BUSINESS_CODE_KEY ??= "<khóa hex chỉ dùng cho test>"` trong `tests/helpers/authorization.ts` cạnh `JWT_SECRET` (wrapper `tests/helpers/run-local-tests.ts` đã truyền nguyên `process.env` nên không cần sửa)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Hàm Feistel, allocator dùng chung, bảng bộ đếm và migration — mọi story phụ thuộc phase này (đồng thời là lõi của US2)

**⚠️ CRITICAL**: Không bắt đầu story nào trước khi phase này xong

### Tests (viết trước, phải FAIL trước khi cài đặt)

- [x] T005 [P] Viết `tests/feistel.test.ts`: với khóa cố định 32 byte, `feistelEncrypt` trên toàn miền 0–99999 cho 100.000 giá trị khác nhau trong miền và `feistelDecrypt` trả lại đúng đầu vào (SC-003); deterministic; hai khóa khác nhau cho kết quả khác nhau ở phần lớn đầu vào; `RangeError` khi giá trị âm, ≥ 100000, không phải số nguyên, hoặc khóa khác 32 byte
- [x] T006 [P] Viết `tests/business-code.test.ts` với transaction client giả (mock `$queryRaw` trả bộ đếm tăng dần) và `exists` giả: `formatBusinessCode("DE", 42)` → `FP-DE-00042`; `parseBusinessCode` chấp nhận đúng 5 chữ số, từ chối `00000`, sai loại, chữ thường được chuẩn hóa; `allocateBusinessCodes` bỏ qua số thứ tự cho ra `00000` hoặc mã nằm trong tập `exists` trả về; cấp `count` mã khác nhau; ném `HttpError` 503 khi bộ đếm vượt 100000 và khi thiếu khóa; **hậu tố của mã cấp cho số thứ tự `s` đúng bằng `feistelEncrypt(s − 1, key)` viết đủ 5 chữ số và `feistelDecrypt(hậu tố) + 1 = s`** (kiểm tra với s = 1, 2, 3, 99, 100000); 1.000 mã cấp liên tiếp không có cặp kế tiếp có phần số liên tiếp nhau (SC-002); loại không có trong danh mục bị từ chối
- [x] T007 Thêm `tests/feistel.test.ts` và `tests/business-code.test.ts` vào script `test:unit` trong `package.json`

### Implementation

- [x] T008 [P] Tạo `src/utils/feistel.ts` theo research R1: hằng `FEISTEL_DOMAIN = 100000`; Feistel nhị phân 18 bit (2 nửa × 9 bit), 8 vòng, hàm vòng = 9 bit thấp của `createHmac("sha256", key).update([round, right])`; `feistelEncrypt(value, key)` và `feistelDecrypt(value, key)` cycle-walking tới khi kết quả < 100000; kiểm tra đầu vào như T005; không I/O
- [x] T009 Cập nhật `prisma/schema.prisma`: model `BusinessCodeCounter` (`codeType` varchar(2) `@id @map("code_type")`, `lastSequence` Int `@map("last_sequence")`, `updatedAt` `@default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)`, `@@map("business_code_counters")`, `@@schema("foodprint")`); thêm `code String? @unique(map: "<bảng>_code_key") @db.VarChar(20)` cho `MealComplaint` và `FoodSafetyIncident`; thêm `code String @unique(map: "registration_requests_code_key") @db.VarChar(20)` cho `RegistrationRequest` (theo data-model.md)
- [x] T010 Tạo migration `prisma/migrations/20261123000100_business_code_feistel/migration.sql` (timestamp sau migration mới nhất `20261122000100_unified_blockchain_proofs`) trong một transaction: tạo `foodprint.business_code_counters` với CHECK `code_type ~ '^[A-Z]{2}$'` và `last_sequence BETWEEN 0 AND 100000`; thêm `registration_requests.code`, backfill `'FP-REG-' || lpad(registration_number::text, 5, '0')`, rồi `SET NOT NULL`, UNIQUE index `registration_requests_code_key`, CHECK `registration_requests_code_format`; thêm `meal_complaints.code` và `food_safety_incidents.code` nullable + UNIQUE + CHECK định dạng loại trừ `00000` (data-model.md). Không seed, không function/trigger. Có thể soạn bằng `npm run db:migrate:create -- --name business_code_feistel` chỉ khi được phép, rồi rà SQL thủ công
- [x] T011 Chạy `npm run prisma:validate` và `npm run prisma:generate` (không đụng DB)
- [x] T012 Tạo `src/utils/business-code.repository.ts`: `nextBusinessCodeSequence(tx: Prisma.TransactionClient, codeType: string): Promise<number>` trong cùng `tx`: gọi `SELECT pg_advisory_xact_lock(hashtext('foodprint:business-code:' || $1))` (khóa advisory theo loại mã — nguyên tắc VII) rồi `$queryRaw` upsert `INSERT INTO foodprint.business_code_counters (code_type, last_sequence, updated_at) VALUES ($1, 1, now()) ON CONFLICT (code_type) DO UPDATE SET last_sequence = business_code_counters.last_sequence + 1, updated_at = now() RETURNING last_sequence`; khi vi phạm CHECK (vượt 100000) chuyển thành lỗi hết dải
- [x] T013 Tạo `src/utils/business-code.ts` (phụ thuộc T003, T008, T012): danh mục `BUSINESS_CODE_TYPES = { RG: "hồ sơ đăng ký", DE: "chuyến giao hàng", CP: "khiếu nại nguyên liệu", MC: "khiếu nại bữa ăn", IC: "sự cố an toàn thực phẩm" } as const`; danh sách chữ viết tắt cấm tái dùng (`LO`, `CB`, `BG`, `SU`, `SF`, `REG`) được assert khi load module; `formatBusinessCode`, `parseBusinessCode`; `allocateBusinessCodes(tx, type, count, exists, deps = { readKey, nextSequence })` theo research R4: với mỗi số thứ tự `s` nhận từ bộ đếm, **hậu tố 5 chữ số = `String(feistelEncrypt(s − 1, key)).padStart(5, "0")`** và mã = `FP-${type}-${hậu tố}` — tuyệt đối không dùng `s` trực tiếp làm hậu tố; bỏ hậu tố `00000` và mã trùng, gọi `exists` theo lô trong cùng `tx`, hết dải → `HttpError(503, "Đã hết dải mã <nhãn>. Vui lòng liên hệ quản trị hệ thống.")`); `allocateBusinessCode` cho một mã. Inject `deps` để T006 chạy không cần DB
- [x] T014 Thêm comment đầu file `src/utils/fp-code.ts` nêu rõ cơ chế tuần tự này chỉ dùng cho `LO`, `CB`, `BG`, `SU`; mã nghiệp vụ danh sách dùng `src/utils/business-code.ts` (không đổi hành vi)
- [x] T015 Chạy `npx tsx --test tests/feistel.test.ts tests/business-code.test.ts` và `npm run typecheck`; tất cả PASS

**Checkpoint**: Hàm dùng chung và schema sẵn sàng

---

## Phase 3: User Story 1 - Mã mới không lộ thứ tự và số lượng bản ghi (Priority: P1) 🎯 MVP

**Goal**: Hồ sơ đăng ký, chuyến giao và khiếu nại nguyên liệu tạo mới nhận mã Feistel; mã cũ giữ nguyên

**Independent Test**: Tạo 3 bản ghi liên tiếp mỗi loại → mã đúng cú pháp, khác nhau, phần số không liên tiếp; 20 thao tác tạo đồng thời không trùng mã; sửa/nộp lại hồ sơ không đổi mã

### Tests for User Story 1

- [x] T016 [P] [US1] Cập nhật `tests/onboarding.test.ts`, `tests/auth-session.test.ts`, `tests/modules.test.ts`, `tests/registration-review.test.ts`: dữ liệu giả của registration có trường `code`; phản hồi `registrationID` lấy từ `code` (cả `FP-REG-00001` cũ và `FP-RG-NNNNN` mới); `registrationNumber` và `code` thô vẫn không lộ ra ngoài allowlist hiện có; nộp lại/sửa hồ sơ (`updateSubmission`) không gọi allocator và giữ nguyên `code`
- [x] T017 [P] [US1] Cập nhật test supplier-order hiện có (`tests/supplier-order-creation.test.ts`) để `deliveryNo` mới đến từ allocator dùng chung (mock `allocateBusinessCode`/repository) thay cho `findHighestCanonicalDeliverySequence`
- [x] T018 [P] [US1] Thêm case integration trong `tests/supplier-order-creation.integration.test.ts`: 20 lần tạo chuyến giao đồng thời (nhiều supplier) cho 20 `delivery_no` khác nhau dạng `FP-DE-[0-9]{5}`; chuyến cũ dạng tuần tự giữ nguyên mã; một lần tạo bị lỗi sau khi đã cấp mã (transaction rollback) rồi tạo lại không sinh mã trùng và bộ đếm không tăng ở lần lỗi; giải mã hậu tố của các mã mới bằng `feistelDecrypt` cho ra các số thứ tự liên tiếp; dùng `BUSINESS_CODE_KEY` cố định cho test
- [x] T019 [P] [US1] Thêm case vào `tests/migrations.test.ts`: sau migration, hồ sơ cũ có `code = FP-REG-…` khớp `registration_number` (kể cả số > 99999 không pad); CHECK từ chối `FP-RG-00000`, `FP-RG-1234`, `FP-XX-12345`; bảng bộ đếm từ chối `last_sequence = 100001`

### Implementation for User Story 1

- [x] T020 [US1] Hồ sơ đăng ký — tạo mới: trong `src/modules/auth/onboarding.repository.ts` thêm `code` vào select dùng cho phản hồi và cho `createSubmission` nhận `code`; thêm hàm `registrationCodesExisting(tx, codes)` trả các mã đã tồn tại; trong `src/modules/auth/onboarding.service.ts` (nhánh gọi `createSubmission` quanh dòng 273) cấp mã bằng `allocateBusinessCode(tx, "RG", exists)` trong cùng transaction trước khi tạo; `updateSubmission` không đổi mã
- [x] T021 [US1] Hồ sơ đăng ký — hiển thị: thay `formatRegistrationID(row.registrationNumber)` bằng `row.code` trong `src/modules/auth/onboarding.service.ts`, `src/modules/auth/session.service.ts`, `src/modules/auth/registration-review-email.ts`, `src/modules/registration/registration.service.ts`; thêm `code` vào `src/modules/registration/registration.select.ts`, `src/utils/session-identity.ts`, `src/types/session-user.ts` (giữ `registrationNumber` chỉ khi còn dùng ở chỗ khác)
- [x] T022 [US1] Chuyến giao: trong `src/modules/supplier-order/supplier-order.repository.ts` thêm `findExistingDeliveryNos(db, codes)` kiểm tra trên toàn bảng `deliveries` (mọi supplier); xóa `findHighestCanonicalDeliverySequence`; xóa `lockSupplierForDeliveryNumber` nếu không còn nơi nào dùng. Trong `src/modules/supplier-order/supplier-order.service.ts` viết lại `reserveNextDeliveryNo` (dòng ~533) dùng `allocateBusinessCode(tx, "DE", …)`; giữ hai chỗ gọi ở dòng ~668 và ~810 trong cùng transaction
- [x] T023 [US1] Khiếu nại nguyên liệu: trong `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts` thay `nextComplaintCodeSequence` bằng `findExistingComplaintCodes(tx, codes)` và một hàm `allocateComplaintCode(tx)` gọi `allocateBusinessCode(tx, "CP", …)`; cập nhật `src/modules/README.md` (đoạn "Phạm vi producer BGH") và ghi phần thay thế contract producer CP vào `specs/feistel-business-codes/contracts/business-code.md` (không sửa `specs/supplier-complaint-response/` vì spec gate chỉ cho phép sửa spec của nhánh này)
- [x] T024 [US1] Chạy `npm run typecheck` và các test T016, T017; T018/T019 chạy qua `npm run test:local:supplier-orders` và `npm run test:local:migrations` khi đã được phép dùng DB tạm

**Checkpoint**: US1 hoạt động độc lập — mã mới không tuần tự cho RG, DE, CP

---

## Phase 4: User Story 2 - Một cách sinh và đọc mã dùng chung cho mọi loại (Priority: P1)

**Goal**: Gỡ các formatter tuần tự riêng lẻ; mọi parser/tìm kiếm đi qua `business-code.ts`, vẫn nhận mã cũ

**Independent Test**: Không còn formatter tuần tự cho RG/DE/CP trong `src/`; tìm kiếm hồ sơ bằng `FP-REG-00001` và `FP-RG-NNNNN` (hoa/thường) trả đúng hồ sơ; đọc khiếu nại nguyên liệu có mã cũ và mã mới đều hợp lệ

### Tests for User Story 2

- [x] T025 [P] [US2] Mở rộng `tests/business-code.test.ts`: `parseLegacyCode` chấp nhận `FP-REG-00001`, `FP-REG-123456`, `FP-DE-100000`, `FP-CP-00042`, từ chối `FP-REG-00000`, `FP-DE-0123456`; `normalizeSearchCode` trả mã in hoa cho chuỗi đúng cú pháp mã cũ hoặc mã mới (ví dụ `fp-rg-04213` → `FP-RG-04213`, `fp-reg-00001` → `FP-REG-00001`) và `null` với chuỗi tên hoặc mã sai cú pháp
- [x] T026 [P] [US2] Cập nhật `tests/modules.test.ts` (case tìm kiếm registration quanh dòng 760–830): `search` là mã cũ hoặc mã mới → filter `OR: [{ code }, nameFilter]`; chuỗi khác → chỉ tìm theo tên
- [x] T027 [P] [US2] Thay `tests/delivery-code.test.ts`, `tests/complaint-code.test.ts`, `tests/registration-id.test.ts` bằng các case parser mã cũ trong `tests/business-code.test.ts`; xóa file test cũ và gỡ khỏi `test:unit` trong `package.json`

### Implementation for User Story 2

- [x] T028 [US2] Trong `src/utils/business-code.ts` thêm `normalizeSearchCode(text)`, `parseLegacyCode(text)` (mã tuần tự cũ `FP-REG|DE|CP-` theo regex hiện có của từng file) và `isStoredBusinessCode(type, text)` chấp nhận mã mới hoặc mã cũ của loại đó
- [x] T029 [US2] `src/modules/registration/registration.repository.ts` (dòng ~52): thay `parseRegistrationID` bằng chuẩn hóa mã (in hoa) và lọc `{ OR: [{ code: normalized }, nameFilter] }`
- [x] T030 [US2] Cập nhật `tests/ingredient-quality-feedback.test.ts` cho mã mới/cũ, rồi sửa `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts` (`assertStoredComplaintCode`, dòng ~51): dùng `isStoredBusinessCode("CP", …)`
- [x] T031 [US2] Xóa `src/utils/delivery-code.ts`, `src/utils/complaint-code.ts`, `src/utils/registration-id.ts` sau khi không còn import; cập nhật import trong `tests/authorization.integration.test.ts` (dòng ~110, ~10368, ~10854) và `tests/supplier-onboarding.integration.test.ts` (dòng ~34, ~2186, ~2307–2344, ~2627, ~2699) sang allocator/parser mới (seed test dùng `formatBusinessCode` hoặc mã cũ cố định; bỏ kiểm tra sequence `ingredient_quality_feedback_complaint_code_seq`)
- [x] T032 [US2] Chạy `grep -rn "formatDeliveryCode\|formatComplaintCode\|formatRegistrationID\|parseRegistrationID\|nextComplaintCodeSequence" src tests` → không còn kết quả; `npm run typecheck`; `npm run test:unit`

**Checkpoint**: Một nơi cho mã hóa, một nơi cho cú pháp (SC-004)

---

## Phase 5: User Story 3 - Bổ sung mã cho các danh sách chưa có mã (Priority: P2)

**Goal**: Khiếu nại bữa ăn (`MC`) và sự cố ATTP (`IC`) có mã; bản ghi cũ được backfill

**Independent Test**: Tạo khiếu nại bữa ăn → phản hồi có `code` `FP-MC-NNNNN`; danh sách/chi tiết hiển thị `code`; chạy backfill gán mã cho bản ghi cũ, chạy lần hai gán 0 dòng

### Tests for User Story 3

- [x] T033 [P] [US3] Thêm case trong test module feedback hiện có `tests/meal-complaint.test.ts`: tạo khiếu nại gọi allocator `MC` trong cùng transaction và trả `code`; danh sách/chi tiết map `code` (kể cả `null` cho bản ghi cũ)
- [x] T034 [P] [US3] Tạo `tests/business-code-backfill.test.ts` (không DB, mock repository): chỉ chọn dòng `code IS NULL`, theo lô, mỗi lô một transaction, idempotent, đếm đúng số dòng; thêm vào `test:unit` trong `package.json`

### Implementation for User Story 3

- [x] T035 [US3] `src/modules/feedback/feedback.repository.ts`: `create` nhận `code`; thêm `findExistingMealComplaintCodes(db, codes)`; select/include trả `code`
- [x] T036 [US3] `src/modules/feedback/feedback.service.ts`: trong transaction tạo khiếu nại (quanh dòng 200) cấp mã bằng `allocateBusinessCode(tx, "MC", …)` trước `repository.create`; hàm map (dòng ~44) thêm `code: row.code ?? null`
- [x] T037 [US3] `src/modules/feedback/feedback.response.dto.ts`: thêm `code: string | null` vào `ComplaintResponseDTO` ngay sau `id`
- [x] T038 [US3] Tạo `src/scripts/backfill-business-codes.ts` theo contract mục 5: mặc định chỉ chấp nhận DB local (dùng lại kiểm tra target như `src/scripts/bootstrap-authorization.ts`/`src/utils/migration-target.ts`), `--azure` yêu cầu `AZURE_DATABASE_HOST`; xử lý `meal_complaints` và `food_safety_incidents` có `code IS NULL` theo lô 100 dòng, sắp `created_at/submitted_at, id`, mỗi lô một transaction dùng `allocateBusinessCodes`; in số dòng đã gán mỗi bảng; truy vấn đặt trong hàm repository riêng trong cùng file hoặc `src/scripts/backfill-business-codes.repository.ts`
- [x] T039 [US3] Thêm script `"business-codes:backfill": "tsx src/scripts/backfill-business-codes.ts"` vào `package.json`
- [x] T040 [US3] Chạy `npm run typecheck` và test T033, T034

**Checkpoint**: Cả ba story hoạt động độc lập

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T041 [P] Cập nhật `src/modules/README.md`: mục `registrationID` (dòng ~85–89) mô tả mã lưu trong cột `code`, mã cũ `FP-REG-` và mới `FP-RG-`; thêm `code` của khiếu nại bữa ăn
- [x] T042 [P] Cập nhật `database/SCHEMA_BASELINE.md`: migration `business_code_feistel`, bảng bộ đếm, các cột `code`, bước vận hành backfill và ghi chú NOT NULL cho `meal_complaints.code`/`food_safety_incidents.code` để lại migration sau
- [x] T043 [P] Cập nhật bảng biến môi trường trong `README.md` (mục 1) thêm `BUSINESS_CODE_KEY`, và mục lệnh trong `AGENTS.md` thêm `npm run business-codes:backfill` (nêu: thao tác vận hành, `--azure` cần cho phép tường minh, CD không chạy)
- [x] T044 Chạy `npm run validate` (lint, format:check, typecheck, build) và `npm run test:unit`; ghi kết quả thật vào mô tả PR
- [ ] T045 Chạy các bước trong `specs/feistel-business-codes/quickstart.md` mục 2–4 trên hạ tầng local khi được phép; ghi lại bước bị chặn nếu thiếu hạ tầng
- [ ] T046 Commit theo Conventional Commits (`docs(spec): ...` cho spec, `refactor(codes): ...` cho code) và mở PR vào `dev` kèm danh sách kiểm chứng thực tế; mô tả PR liệt kê 3 ngoại lệ trong Complexity Tracking của `plan.md` (cột `code` MC/IC tạm nullable, mã DE cũ trùng giữa supplier, hồ sơ cũ giữ `FP-REG`) và yêu cầu reviewer xác nhận chấp thuận theo Governance của hiến chương

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc
- **Foundational (Phase 2)**: sau Setup; chặn mọi story. Thứ tự trong phase: T005–T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015
- **US1 (Phase 3)**: sau Phase 2
- **US2 (Phase 4)**: sau Phase 2; T029–T031 nên làm sau US1 vì cùng chạm file auth/registration/ingredient-quality-feedback
- **US3 (Phase 5)**: sau Phase 2; độc lập với US1/US2 (khác module)
- **Polish (Phase 6)**: sau các story muốn giao

### User Story Dependencies

- **US1 (P1)**: chỉ phụ thuộc Foundational
- **US2 (P1)**: phụ thuộc Foundational; tuần tự sau US1 khi chạm cùng file
- **US3 (P2)**: chỉ phụ thuộc Foundational

### Within Each User Story

- Test viết trước và FAIL trước khi cài đặt
- Repository → service → DTO/mapping → chạy test

### Parallel Opportunities

- T002, T003, T004 song song
- T005, T006 song song; T008 song song với T009/T010 (khác file)
- US1: T016–T019 song song; T020/T021 (auth) song song với T022 (supplier-order) và T023 (ingredient-quality-feedback)
- US3 có thể làm song song toàn bộ với US1 bởi người khác
- Polish: T041–T043 song song

---

## Parallel Example: User Story 1

```bash
# Test song song:
Task: "T016 Cập nhật test registration/auth cho trường code"
Task: "T017 Cập nhật tests/supplier-order-creation.test.ts dùng allocator"
Task: "T019 Thêm case migration vào tests/migrations.test.ts"

# Cài đặt song song (khác module):
Task: "T020+T021 Hồ sơ đăng ký trong src/modules/auth và src/modules/registration"
Task: "T022 Chuyến giao trong src/modules/supplier-order"
Task: "T023 Khiếu nại nguyên liệu trong src/modules/ingredient-quality-feedback"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 + Phase 2 (hàm dùng chung, migration)
2. Phase 3 (US1) → kiểm chứng mã mới không tuần tự, không trùng khi đồng thời
3. Dừng lại review trước khi gỡ helper cũ

### Incremental Delivery

1. Setup + Foundational → nền tảng sẵn sàng
2. US1 → mã Feistel cho RG/DE/CP (MVP)
3. US2 → gỡ trùng lặp, tìm kiếm mã cũ/mới
4. US3 → MC/IC + backfill
5. Polish → tài liệu, validate, PR

### Sau khi merge (ngoài phạm vi PR này)

- Người vận hành chạy `npm run business-codes:backfill` trên từng môi trường (Azure cần cho phép tường minh)
- Feature tiếp theo: migration đặt NOT NULL cho `meal_complaints.code` và `food_safety_incidents.code`; cân nhắc xóa sequence `ingredient_quality_feedback_complaint_code_seq`
