# Kế hoạch

## Thay đổi BE (module `blockchain-proof`)

- `repository`:
  - `mealSubjects(db, where)` dùng chung: đọc các suất ăn khớp điều kiện (cùng trường, cùng ngày), gộp mẻ, mẫu, giao hàng của mọi lớp và trả `meal` (khối, lớp), `steps`.
  - `gradeChainSubjects({ schoolId, gradeId, date, mealType })` cho FR-2, FR-5; `chainSubjects(id, schoolId)` cho API theo một lớp.
  - `listGradeMeals(date, schoolId)` gom theo trường, khối, bữa cho FR-1, FR-4; `mealStatus` tính trạng thái chung.
  - `findPublicSchool(code)`: trường `ACTIVE` theo mã, không phân biệt hoa thường, giống trang công khai của trường.
- `service`:
  - `gradeMeals`, `gradeChain` (nội bộ), `publicGradeMeals`, `publicGradeChain`.
  - Tách `buildChain(db, subjects, mealAllocationId, { verify, persist })` dùng chung; `verifyRow(..., persist)` bỏ qua `setVerification` khi công khai.
  - `publicView` đặt `deliveryNo`, `vehiclePlate`, `batchCode`, `lastError` về `null`.
- `validation`/`request.dto`/`response.dto`/`controller`/`routes`: 4 route mới (2 nội bộ, 2 công khai); `gradeId` nhận UUID hoặc `none`. Route công khai không qua `authHandler`.

## Thay đổi FE

- `services/BlockchainProofService`: thêm kind `delivery-declarations`, `meal-distributions`; `listGradeMeals`, `getGradeChain`, `listPublicGradeMeals`, `getPublicGradeChain` (nhận `key` của dòng danh sách và ngày); `chainAdapter.js` dựng các chặng, trạng thái, sự cố, nhãn khối.
- `components/Traceability/*`: giao diện dùng chung (`TraceabilityView`, `MealPicker`, `TraceSummary`, `TraceTimeline`, `TraceStopProofs`, `TraceEmpty`).
- Trang `pages/SCHOOL/Traceability` (thay chỗ đang trỏ nhầm tới `KitchenCooking`) và `pages/ANONYMOUS/SchoolTraceability`; menu nội bộ và mục "Truy xuất nguồn gốc" trên header trang trường.

## Quyết định

- Đặt API công khai trong module `blockchain-proof` thay vì `organization`, để mọi truy vấn bằng chứng ở một chỗ.
- Truy xuất theo khối: các lớp cùng khối dùng chung mẻ và nguyên liệu, nên xem từng lớp chỉ lặp lại cùng một hành trình. Bằng chứng phân phối vẫn theo ngày của trường.
- Bước không có bằng chứng vẫn được trả trong `steps` để FE hiện "chưa có bằng chứng" thay vì làm mất bước.
- Không lưu kết quả kiểm chứng công khai: tránh người ngoài ghi vào DB và tránh làm nhiễu lịch sử kiểm tra của trường.
- Không thêm giới hạn tần suất riêng: mỗi lần kiểm chứng đọc tối đa vài bản ghi trên chain; giới hạn chung 300 lần/phút/IP đủ cho giai đoạn này.

## Rủi ro

- Tên NCC và món ăn công khai: đây là thông tin trường đã công khai trên trang thực đơn; biển số và mã nội bộ được ẩn.
- Mỗi lần kiểm chứng công khai gọi RPC. Nếu lưu lượng tăng cần thêm giới hạn riêng hoặc cache ngắn.
- Trường chưa có `code` thì không có trang công khai (giống trang thực đơn hiện tại).
