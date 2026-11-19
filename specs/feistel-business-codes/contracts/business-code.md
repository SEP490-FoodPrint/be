# Contract: Mã nghiệp vụ dùng chung

## 1. Cú pháp

- Mã mới: `FP-<XX>-<NNNNN>` — `XX` là 2 chữ in hoa trong danh mục, `NNNNN` đúng 5 chữ số, khác `00000`.
- Mã cũ vẫn hợp lệ khi đọc/tìm kiếm: `FP-REG-<≥5 chữ số>`, `FP-DE-<≥5 chữ số>`, `FP-CP-<≥5 chữ số>` theo định dạng tuần tự trước đây.
- So khớp tìm kiếm không phân biệt hoa thường; mã lưu luôn chữ in hoa.

## 2. Hàm dùng chung (nội bộ backend)

| Hàm                                              | Đầu vào                                                                                             | Đầu ra                        | Lỗi                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `feistelEncrypt(value, key)`                     | số nguyên `0 ≤ value < 100000`, khóa 32 byte                                                        | số nguyên trong `[0, 100000)` | `RangeError` khi đầu vào ngoài miền hoặc khóa sai độ dài |
| `feistelDecrypt(value, key)`                     | như trên                                                                                            | giá trị gốc                   | như trên                                                 |
| `formatBusinessCode(type, digits)`               | loại trong danh mục, `1 ≤ digits ≤ 99999`                                                           | `FP-XX-NNNNN`                 | `RangeError`                                             |
| `parseBusinessCode(type, text)`                  | chuỗi                                                                                               | số 5 chữ số hoặc `null`       | —                                                        |
| `allocateBusinessCodes(tx, type, count, exists)` | transaction client, loại, số lượng ≥ 1, `exists(codes) → Promise<Set<string>>` chạy trong cùng `tx` | mảng mã mới, không trùng      | `HttpError 503` khi thiếu/sai khóa hoặc hết dải          |

Bất biến: với cùng khóa, `feistelDecrypt(feistelEncrypt(x)) = x` cho mọi `x` trong miền; `allocateBusinessCodes` không bao giờ trả mã đã tồn tại hay `00000`.

**Producer khiếu nại nguyên liệu (`CP`)** — thay thế phần cấp mã trong `specs/supplier-complaint-response/contracts/complaint-code-producer.md`. Spec đó được giữ nguyên vì spec gate chỉ cho phép sửa spec của nhánh hiện tại. Mã khiếu nại mới không còn lấy từ sequence `ingredient_quality_feedback_complaint_code_seq`. Producer gọi `ingredientQualityFeedbackRepository.allocateComplaintCode(tx)` trong cùng transaction tạo khiếu nại; hàm này cấp `FP-CP-NNNNN` qua `allocateBusinessCode(tx, "CP", …)` và kiểm tra không trùng với mọi `complaint_code` đã có. Mã tuần tự cũ đã phát hành vẫn hợp lệ khi đọc (`isStoredBusinessCode("CP", …)`). Các mục về sequence trong contract cũ chỉ còn giá trị lịch sử.

## 3. Cấu hình

| Biến                | Bắt buộc   | Định dạng    | Ghi chú                                                                                  |
| ------------------- | ---------- | ------------ | ---------------------------------------------------------------------------------------- |
| `BUSINESS_CODE_KEY` | Khi cấp mã | 64 ký tự hex | Mỗi môi trường một khóa; không đổi sau khi đã phát hành mã; không log, không trả qua API |

## 4. Thay đổi hợp đồng HTTP

| Endpoint/phản hồi                                                                     | Thay đổi                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Các phản hồi có `registrationID` (auth session, onboarding, registration list/detail) | Tên/kiểu trường giữ nguyên; giá trị lấy từ mã đã lưu: hồ sơ cũ `FP-REG-…` không đổi, hồ sơ mới `FP-RG-NNNNN` |
| Tìm kiếm registration (`search`)                                                      | Nhận cả `FP-REG-…` và `FP-RG-…`                                                                              |
| Chuyến giao (`deliveryNo`) và khiếu nại nguyên liệu (`complaintCode`)                 | Không đổi tên/kiểu; mã mới theo Feistel                                                                      |
| Khiếu nại bữa ăn (`feedback` module: tạo, danh sách, chi tiết)                        | Thêm trường `code: string \| null` (null chỉ với bản ghi cũ chưa backfill) cạnh `id`                         |
| Sự cố ATTP                                                                            | Không có endpoint list/detail hiện tại → không đổi HTTP                                                      |
| Email kết quả xét duyệt hồ sơ                                                         | Hiển thị mã đã lưu                                                                                           |

Lỗi mới: `503` với thông báo tiếng Việt khi không cấp được mã (thiếu khóa hoặc hết dải), qua envelope `sendError` hiện có.

## 5. Script vận hành

`npm run business-codes:backfill [-- --azure]`: gán mã `MC`/`IC` cho bản ghi `code IS NULL`, idempotent, theo lô trong transaction; in số dòng đã gán. `--azure` yêu cầu `AZURE_DATABASE_HOST` và migration đã áp dụng đủ; CD không chạy script này.
