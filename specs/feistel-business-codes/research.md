# Research: Mã nghiệp vụ FP thống nhất mã hóa bằng Feistel permutation

## Hiện trạng đã khảo sát

| Loại                  | Lưu ở đâu                                                                                                                                | Bộ sinh                                                                                                                                     | Phạm vi duy nhất                                                                                         | Người dùng mã                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hồ sơ đăng ký         | Không có cột mã; `registration_requests.registration_number` BIGINT autoincrement, hiển thị bằng `formatRegistrationID` → `FP-REG-00001` | DB autoincrement                                                                                                                            | Toàn hệ thống                                                                                            | `onboarding.service`, `session.service`, `registration.service`, `registration-review-email`, tìm kiếm trong `registration.repository` qua `parseRegistrationID` |
| Chuyến giao           | `deliveries.delivery_no` varchar(80)                                                                                                     | `supplier-order.service#reserveNextDeliveryNo`: khóa dòng supplier, `MAX` số hiện có của supplier + 1, `formatDeliveryCode`                 | `@@unique([supplierId, deliveryNo])` — mỗi supplier có dãy riêng, `FP-DE-00001` tồn tại ở nhiều supplier | Trang truy xuất công khai (`public-trace-html`), dữ liệu chứng thực blockchain, delivery/warehouse/meal-traceability DTO                                         |
| Khiếu nại nguyên liệu | `ingredient_quality_feedback.complaint_code` varchar(25) UNIQUE + CHECK định dạng (số ≥ 1)                                               | Sequence `ingredient_quality_feedback_complaint_code_seq` qua `nextComplaintCodeSequence(tx)`; producer HTTP phía trường chưa có trong repo | Toàn hệ thống                                                                                            | `assertStoredComplaintCode` khi đọc, DTO supplier/school                                                                                                         |
| Khiếu nại bữa ăn      | Chưa có                                                                                                                                  | —                                                                                                                                           | —                                                                                                        | `feedback` module (create/list/detail)                                                                                                                           |
| Sự cố ATTP            | Chưa có                                                                                                                                  | —                                                                                                                                           | —                                                                                                        | Không có API list/detail; chỉ được tham chiếu bằng `incidentId` trong reporting/inspection/school-overview                                                       |

Ngoài phạm vi nhưng dùng chung `src/utils/fp-code.ts`: `LO`, `CB`, `BG`, `SU` (`reserveFpCodes`), và `SF` (`source-facility-code.ts`). Chúng giữ nguyên.

## Quyết định

### R1. Thuật toán Feistel trên miền 0–99999

- **Decision**: Feistel nhị phân cân bằng 18 bit (2 nửa × 9 bit, miền 262.144 ≥ 100.000), 8 vòng, hàm vòng = HMAC-SHA256(key, `round || right`) lấy 9 bit thấp, kết hợp bằng XOR. Thu hẹp về miền 0–99999 bằng cycle-walking: mã hóa lặp lại cho tới khi kết quả < 100.000. Giải mã chạy các vòng ngược và cũng cycle-walking. Chỉ dùng `node:crypto`.
- **Rationale**: Feistel nhị phân với cycle-walking giữ tính hoán vị một-một trên miền con (định lý cycle-walking); số lần lặp kỳ vọng ≈ 2,6 và hữu hạn. HMAC-SHA256 là PRF chuẩn có sẵn trong Node, không thêm dependency. 8 vòng vượt mức tối thiểu (4) cho hoán vị giả ngẫu nhiên mạnh. Toàn miền 100.000 giá trị kiểm thử được trong unit test.
- **Alternatives considered**: Feistel cơ số 10 / tích `317 × 317` (FFX/FF1-style) — chính xác hơn về miền nhưng phức tạp, dễ sai biên. Thư viện FPE ngoài (FF1/FF3) — thêm dependency khi hiến chương yêu cầu không thêm khi chưa duyệt. Hàm băm đơn thuần — không phải hoán vị, có thể trùng.

### R2. Khóa Feistel

- **Decision**: Biến môi trường `BUSINESS_CODE_KEY`, 64 ký tự hex (32 byte). Đọc qua hàm `readBusinessCodeKey()` trong `src/config/env.ts` tại thời điểm cấp mã; thiếu/sai định dạng → `HttpError(503, "Không thể cấp mã nghiệp vụ. Vui lòng thử lại sau.")` và log cấu hình lỗi (không log giá trị khóa). Thêm placeholder vào `.env.example` và `.env.test.example`; test dùng khóa cố định trong code test.
- **Rationale**: FR-008: khóa ngoài source, lỗi rõ ràng, không có khóa mặc định. Đọc lazy để môi trường dev chưa cấu hình vẫn khởi động được cho tính năng khác (giống cấu hình Resend).
- **Alternatives considered**: Bắt buộc khi khởi động — làm hỏng `npm run dev` của thành viên chưa cập nhật `.env`; khóa mặc định cho dev — vi phạm FR-008.

### R3. Lưu số thứ tự theo loại mã

- **Decision**: Bảng mới `foodprint.business_code_counters(code_type varchar(2) PK, last_sequence integer NOT NULL, updated_at timestamptz)`, CHECK `last_sequence BETWEEN 0 AND 100000` và `code_type ~ '^[A-Z]{2}$'`. Cấp số trong transaction tạo bản ghi: trước tiên `SELECT pg_advisory_xact_lock(hashtext('foodprint:business-code:<XX>'))` (khóa advisory theo loại mã như nguyên tắc VII yêu cầu), sau đó một câu lệnh upsert: `INSERT ... VALUES (type, 1) ON CONFLICT (code_type) DO UPDATE SET last_sequence = counters.last_sequence + 1 RETURNING last_sequence`. Khóa dòng của upsert giữ đến cuối transaction nên các lần cấp đồng thời của cùng loại được tuần tự hóa; rollback trả lại số thứ tự.
- **Rationale**: Mã sau Feistel không cho phép suy ra số lớn nhất từ dữ liệu như `reserveFpCodes` đang làm, nên phải lưu bộ đếm riêng. Upsert tự tạo dòng lần đầu nên migration không cần seed dữ liệu cấu hình. Allocator vẫn lấy `pg_advisory_xact_lock` theo loại mã trước upsert, theo nguyên tắc VII của hiến chương; khóa dòng bộ đếm tự nó đã tuần tự hóa các lần cấp.
- **Alternatives considered**: PostgreSQL SEQUENCE mỗi loại — không rollback, phải tạo sequence cho từng loại mới bằng migration; advisory lock + tính `MAX` qua giải mã — phải giải mã toàn bộ mã, chậm và lẫn với mã cũ.

### R4. Ánh xạ số thứ tự → mã, bỏ qua trùng và `00000`

- **Decision**: Số thứ tự `s ∈ [1, 100000]` → `n = feistel(s − 1)` → `FP-<XX>-<n 5 chữ số>`. Nếu `n = 0` hoặc mã đã tồn tại (kiểm tra qua callback `exists(code)` do repository của module cung cấp, chạy trong cùng transaction) thì cấp số thứ tự kế tiếp và thử lại. Khi bộ đếm vượt 100.000 → `HttpError(503, "Đã hết dải mã <loại>.")` (lỗi vận hành, không phải lỗi người dùng). Có hàm cấp nhiều mã một lần cho thao tác tạo hàng loạt.
- **Rationale**: Đáp ứng FR-006, FR-007 và quyết định giữ mã cũ (Q1). Bỏ `00000` giữ tương thích CHECK hiện có của `complaint_code` (số ≥ 1) và parser cũ. Vòng thử bị chặn bởi bộ đếm nên luôn kết thúc.
- **Alternatives considered**: Cho phép `00000` — phải sửa CHECK và parser cũ, không có lợi ích.

### R5. Chuyến giao: phạm vi duy nhất

- **Decision**: Mã mới dùng một bộ đếm `DE` toàn hệ thống; `exists` kiểm tra `delivery_no` trên toàn bảng (mọi supplier). Bỏ `findHighestCanonicalDeliverySequence` và việc khóa dòng supplier chỉ để đánh số (giữ nếu khóa còn phục vụ mục đích khác — kiểm tra khi triển khai). Giữ ràng buộc `uq_deliveries_supplier_no`; không thêm UNIQUE toàn cục vì dữ liệu cũ đã trùng giữa các supplier.
- **Rationale**: Mã mới duy nhất toàn hệ thống mà không phải sửa dữ liệu cũ (Q1). Không đổi tên cột `delivery_no` (giữ định danh DB đã duyệt).
- **Alternatives considered**: Bộ đếm theo từng supplier — vẫn lộ số lượng chuyến của supplier sau giải mã và cần khóa riêng; UNIQUE toàn cục — vỡ với dữ liệu cũ.

### R6. Khiếu nại nguyên liệu `CP`

- **Decision**: Thay `nextComplaintCodeSequence` bằng allocator dùng chung (`exists` kiểm tra `complaint_code`). Giữ CHECK và UNIQUE hiện có (mã 5 chữ số khác `00000` vẫn hợp lệ). Sequence cũ không còn được dùng; giữ nguyên trong DB ở feature này để không đụng tới test/migration đã áp dụng, ghi nhận việc xóa là dọn dẹp sau. Phần thay thế contract producer được ghi trong `contracts/business-code.md` của spec này; không sửa `specs/supplier-complaint-response/` vì spec gate chỉ cho phép sửa spec của nhánh hiện tại.
- **Rationale**: Producer HTTP chưa có, nên chỉ cần đổi allocator; mã cũ hợp lệ theo CHECK hiện tại.

### R7. Hồ sơ đăng ký `RG`

- **Decision**: Migration thêm `registration_requests.code varchar(26)` (đủ cho `FP-REG-` + 19 chữ số BIGINT), backfill bằng SQL `'FP-REG-' || CASE WHEN registration_number < 100000 THEN lpad(...,5,'0') ELSE registration_number::text END` (đúng giá trị đang hiển thị; `lpad` đơn thuần sẽ cắt số > 99999), rồi NOT NULL + UNIQUE + CHECK `^FP-(REG-([0-9]{5}|[1-9][0-9]{5,18})|RG-[0-9]{5})$`. Hồ sơ mới: allocator `RG` trong transaction `createSubmission`; nộp lại/sửa hồ sơ không đổi mã. Giữ `registration_number` (không xóa cột, vẫn autoincrement). Response giữ tên trường `registrationID`, giá trị lấy từ cột `code`. Tìm kiếm: chuỗi khớp `FP-REG-…` hoặc `FP-RG-…` (không phân biệt hoa thường như hiện nay) → so khớp chính xác cột `code` (chuẩn hóa chữ hoa và pad 5 chữ số cho `FP-REG`).
- **Rationale**: Backfill không cần khóa Feistel nên làm được trong migration và NOT NULL ngay. Giữ tên trường response (FR-014).
- **Alternatives considered**: Tiếp tục tính từ `registration_number` — không lưu được mã Feistel.

### R8. Khiếu nại bữa ăn `MC` và sự cố `IC`: backfill cần khóa

- **Decision**: Migration thêm cột `code varchar(20)` **nullable** + UNIQUE + CHECK `code IS NULL OR code ~ '^FP-MC-[0-9]{5}$'` (tương tự `IC`) và loại trừ `00000`. Bản ghi mới nhận mã qua allocator trong transaction tạo (`feedback.repository#create` cho MC; IC chưa có luồng tạo, chỉ chuẩn bị allocator). Bản ghi cũ được cấp mã bằng script vận hành `npm run business-codes:backfill` (idempotent, chỉ cập nhật dòng `code IS NULL`, theo lô, trong transaction, dùng cùng allocator). Script chạy local mặc định; `-- --azure` là thao tác vận hành tường minh như `auth:bootstrap`, CD không chạy. Sau khi backfill xong trên mọi môi trường, một migration tiếp theo (feature sau) đặt NOT NULL.
- **Rationale**: Hiến chương cấm SQL function/trigger và khóa không được nằm trong source/migration, nên migration không thể tính Feistel. Chia hai bước cho phép CD deploy cột trước, rồi người vận hành backfill bằng khóa của môi trường.
- **Alternatives considered**: Backfill mã tuần tự trong migration (như `CP` từng làm) — trái quyết định Q3/FR-011 "cấp mã mới qua Feistel"; NOT NULL ngay — migration sẽ thất bại vì dữ liệu cũ.

### R9. Bố cục code dùng chung

- **Decision**:
  - `src/utils/feistel.ts`: thuần, không I/O — `feistelEncrypt(value, key)`, `feistelDecrypt(value, key)`, hằng `FEISTEL_DOMAIN = 100000`.
  - `src/utils/business-code.ts`: danh mục `BUSINESS_CODE_TYPES = { RG, DE, CP, MC, IC }` (nhãn tiếng Việt cho thông báo lỗi), `formatBusinessCode`, `parseBusinessCode` (chỉ mã mới 5 chữ số), `isLegacyCode`/parser mã cũ cho tìm kiếm, và `allocateBusinessCodes(tx, type, count, exists)`.
  - SQL upsert bộ đếm đặt trong `src/utils/business-code.repository.ts` (một hàm nhận transaction client), theo cách `fp-code.ts` đang làm cho hạ tầng dùng chung.
  - `delivery-code.ts`, `complaint-code.ts`, `registration-id.ts` thu gọn: chỉ giữ parser mã cũ cần cho đọc/tìm kiếm (hoặc chuyển vào `business-code.ts`) và xóa formatter tuần tự không còn dùng; test tương ứng cập nhật theo.
- **Rationale**: SC-004 — một nơi cho mã hóa, một nơi cho cú pháp; thêm loại mới chỉ cần thêm vào danh mục.
- **Alternatives considered**: Mở rộng `fp-code.ts` — trộn hai cơ chế (tuần tự cho LO/CB/BG/SU và Feistel), dễ nhầm; giữ tách và ghi chú trong `fp-code.ts`.

### R10. Kiểm thử

- **Decision**: Unit (không hạ tầng): `tests/feistel.test.ts` (toàn miền 100.000, hoán vị + giải ngược, khóa khác cho kết quả khác, deterministic), `tests/business-code.test.ts` (format/parse, bỏ `00000`, bỏ trùng qua `exists` giả, hết dải, thiếu/sai khóa, không có 2 mã liền kề có phần số liên tiếp trong 1.000 mã). Cập nhật `delivery-code`, `complaint-code`, `registration-id`, `modules`, `onboarding` tests. Thêm file mới vào `test:unit`. Migration tests: cột mới, backfill `FP-REG`, CHECK. Integration (DB tạm): 20 thao tác tạo đồng thời không trùng (SC-001).
- **Rationale**: Theo hiến chương — Node test runner, không thêm framework.
