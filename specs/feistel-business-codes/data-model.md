# Data Model: Mã nghiệp vụ FP thống nhất mã hóa bằng Feistel permutation

Mọi thay đổi nằm trong schema `foodprint`, qua migration mới; không sửa migration đã áp dụng. Không thêm SQL function/trigger, không seed dữ liệu.

## Bảng mới: `business_code_counters` (Prisma `BusinessCodeCounter`)

| Cột                              | Kiểu           | Ràng buộc                              | Ý nghĩa                                                 |
| -------------------------------- | -------------- | -------------------------------------- | ------------------------------------------------------- |
| `code_type` (`codeType`)         | varchar(2)     | PK, CHECK `~ '^[A-Z]{2}$'`             | Chữ viết tắt loại mã (`RG`, `DE`, `CP`, `MC`, `IC`)     |
| `last_sequence` (`lastSequence`) | integer        | NOT NULL, CHECK `BETWEEN 0 AND 100000` | Số thứ tự cuối cùng đã cấp (kể cả số bị bỏ qua)         |
| `updated_at` (`updatedAt`)       | timestamptz(6) | NOT NULL, default now(), `@updatedAt`  | Lần cấp gần nhất; câu upsert SQL đặt tường minh `now()` |

- Dòng được tạo lần đầu bởi upsert khi cấp mã; migration không chèn dữ liệu.
- Không có FK; chỉ được ghi trong transaction tạo bản ghi nghiệp vụ hoặc script backfill.

## Bảng thay đổi

### `registration_requests` (`RegistrationRequest`)

| Thay đổi                | Chi tiết                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thêm `code` varchar(26) | Backfill `'FP-REG-' \|\| CASE WHEN registration_number < 100000 THEN lpad(registration_number::text, 5, '0') ELSE registration_number::text END` (giữ đúng mã đang hiển thị); sau đó NOT NULL |
| UNIQUE                  | `registration_requests_code_key`                                                                                                                                                              |
| CHECK                   | `registration_requests_code_format`: `code ~ '^FP-REG-([0-9]{5}\|[1-9][0-9]{5,18})$' OR (code ~ '^FP-RG-[0-9]{5}$' AND code <> 'FP-RG-00000')`                                                |
| Giữ nguyên              | `registration_number` (autoincrement, không còn dùng để hiển thị)                                                                                                                             |

Quy tắc: mã gán trong `createSubmission`; `updateSubmission`/duyệt/từ chối không đổi mã.

### `deliveries` (`Delivery`)

| Thay đổi           | Chi tiết                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Không đổi cấu trúc | `delivery_no` là trường mã; giữ `uq_deliveries_supplier_no`                                                |
| Hành vi            | Mã mới `FP-DE-NNNNN` từ bộ đếm `DE` toàn hệ thống, không trùng với bất kỳ `delivery_no` nào trên toàn bảng |

### `ingredient_quality_feedback` (`IngredientQualityFeedback`)

| Thay đổi           | Chi tiết                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Không đổi cấu trúc | `complaint_code` UNIQUE + CHECK hiện có vẫn chấp nhận mã Feistel 5 chữ số khác `00000`                              |
| Hành vi            | Mã mới từ bộ đếm `CP`; sequence `ingredient_quality_feedback_complaint_code_seq` không còn được dùng (giữ trong DB) |

### `meal_complaints` (`MealComplaint`)

| Thay đổi                         | Chi tiết                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Thêm `code` varchar(20) nullable | Bản ghi mới luôn có mã; bản ghi cũ được script backfill gán                                            |
| UNIQUE                           | `meal_complaints_code_key`                                                                             |
| CHECK                            | `meal_complaints_code_format`: `code IS NULL OR (code ~ '^FP-MC-[0-9]{5}$' AND code <> 'FP-MC-00000')` |

### `food_safety_incidents` (`FoodSafetyIncident`)

| Thay đổi                         | Chi tiết                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Thêm `code` varchar(20) nullable | Hiện chưa có luồng tạo trong backend; bản ghi cũ được script backfill gán                                    |
| UNIQUE                           | `food_safety_incidents_code_key`                                                                             |
| CHECK                            | `food_safety_incidents_code_format`: `code IS NULL OR (code ~ '^FP-IC-[0-9]{5}$' AND code <> 'FP-IC-00000')` |

NOT NULL cho `meal_complaints.code` và `food_safety_incidents.code` để lại cho một migration sau khi backfill đã chạy trên mọi môi trường (xem research R8).

## Danh mục loại mã (cấu hình trong code)

| Mã   | Loại                  | Bảng.cột                                     | Kiểm tra trùng           |
| ---- | --------------------- | -------------------------------------------- | ------------------------ |
| `RG` | Hồ sơ đăng ký         | `registration_requests.code`                 | Toàn bảng                |
| `DE` | Chuyến giao           | `deliveries.delivery_no`                     | Toàn bảng (mọi supplier) |
| `CP` | Khiếu nại nguyên liệu | `ingredient_quality_feedback.complaint_code` | Toàn bảng                |
| `MC` | Khiếu nại bữa ăn      | `meal_complaints.code`                       | Toàn bảng                |
| `IC` | Sự cố ATTP            | `food_safety_incidents.code`                 | Toàn bảng                |

Chữ viết tắt đang dùng bởi cơ chế cũ, không được tái sử dụng: `LO`, `CB`, `BG`, `SU`, `SF`, và `REG` (mã hồ sơ cũ).

## Vòng đời mã

1. Transaction tạo bản ghi gọi allocator → khóa advisory theo loại mã → upsert bộ đếm → `s`.
2. Hậu tố `n = feistelEncrypt(s − 1, khóa)`, mã = `FP-<XX>-` + `n` đủ 5 chữ số; nếu `n = 0` hoặc mã đã tồn tại → lặp với `s + 1`.
3. `s > 100000` → lỗi hết dải, transaction rollback (bộ đếm không đổi).
4. Ghi bản ghi với mã; commit. Mã không bao giờ đổi sau đó.
