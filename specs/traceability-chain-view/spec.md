# Màn hình truy xuất nguồn gốc bữa ăn: nội bộ và công khai

**Feature Branch**: `feat/traceability-chain-view`

**Created**: 2026-11-17

**Status**: Draft — chờ nhóm duyệt

## Bối cảnh

`specs/unified-blockchain-proofs` đã có API kiểm chứng cả chuỗi của một suất ăn:
`GET /api/blockchain-proofs/chains/meal-allocations/:id?verify=true`. API này chưa đủ để dựng màn hình:

- Chỉ trả các bước **đã có** bằng chứng. Bước chưa niêm phong thì biến mất, người xem không biết thiếu gì.
- Không có thông tin đọc được (tên NCC, món, số suất, giờ). FE phải gọi thêm nhiều API khác.
- Không có cách chọn suất ăn theo ngày. `/api/meal-allocations` chỉ trả hôm nay.
- Truy theo từng lớp quá chi tiết: các lớp cùng khối ăn cùng mẻ, cùng nguyên liệu. Đơn vị truy xuất nhỏ nhất là **khối**, không phải lớp.
- Chỉ nhân viên trường đăng nhập mới xem được. Phụ huynh và người ngoài không truy xuất được.

## Mục tiêu

1. Trang nội bộ `/school/traceability` cho nhân viên bếp, cán bộ dinh dưỡng và ban giám hiệu: chọn ngày, chọn khối, xem hành trình kiểu theo dõi đơn giao hàng, kiểm tra toàn vẹn.
2. Trang công khai `/school/:schoolCode/traceability` cho mọi người, không cần đăng nhập, từng trường riêng.
3. Khi dữ liệu bị sửa sau niêm phong, hoặc thiếu niêm phong, bước đó hiện rõ tại đúng chỗ trên hành trình.

Không làm:

- Không đổi contract, bảng `blockchain_proofs` hay cách tạo bằng chứng.
- Không thay nhánh `feat/meal-traceability` của Nodaco35. Hai bên thống nhất sau; spec này không phụ thuộc nhánh đó.

## Yêu cầu

### API nội bộ (cần đăng nhập, quyền `traceability.view`)

- **FR-1** `GET /api/blockchain-proofs/chains/grade-meals?date=YYYY-MM-DD[&schoolId=]` trả bữa ăn của ngày gom theo trường, khối và bữa: `key` (`<gradeId|none>:<mealType>`), khối, trường, bữa, số lớp, tổng suất, trạng thái chung, giờ phát sớm nhất. Lớp chưa xếp khối gom thành một nhóm "Chưa xếp khối" (`gradeId = null`). Tài khoản trường chỉ thấy trường mình; `schoolId` chỉ có tác dụng với tài khoản hệ thống.
  - Trạng thái chung: `FINALIZED`/`DISTRIBUTED` khi mọi lớp (không tính lớp huỷ) đã như vậy, `PARTIAL` khi chỉ một phần lớp đã phát, `CANCELLED` khi mọi lớp huỷ, còn lại `ALLOCATED`.
- **FR-2** `GET /api/blockchain-proofs/chains/grade-meals/:gradeId?date=&mealType=LUNCH|AFTERNOON[&verify=][&schoolId=]` (`gradeId` là UUID hoặc `none`) trả hành trình của cả khối:
  - `meal`: khối, bữa, tổng suất, trạng thái chung, giờ phát và danh sách lớp (tên, số suất, trạng thái, giờ phát).
  - `steps`: mọi giao hàng, mẻ nấu, mẫu lưu của các lớp trong khối (gộp, không lặp) và bước phân phối của ngày, **kể cả khi chưa có bằng chứng**, kèm thông tin đọc được. Số suất của mẻ là phần chia cho khối. Bằng chứng gắn với bước qua `recordId`.
  - Tài khoản hệ thống xem `none` phải truyền `schoolId`, nếu không trả 400.
  - `GET /chains/meal-allocations/:id` (theo một lớp) giữ nguyên để tương thích, trả cùng cấu trúc với `mealAllocationId`.
- **FR-3** Kiểm chứng nội bộ vẫn lưu kết quả như trước.

### API công khai (không cần đăng nhập)

- **FR-4** `GET /api/blockchain-proofs/public/schools/:schoolCode/grade-meals?date=` — như FR-1 nhưng theo mã trường đang hoạt động.
- **FR-5** `GET /api/blockchain-proofs/public/schools/:schoolCode/grade-meals/:gradeId?date=&mealType=&verify=` — như FR-2, giới hạn trong trường đó, và:
  - Ẩn thông tin vận hành: biển số xe, mã phiếu giao, mã mẻ nấu, lỗi gửi giao dịch (`null`).
  - `verify=true` đọc blockchain nhưng **không ghi** kết quả vào DB, để người ngoài không làm thay đổi thứ nhân viên thấy.
  - Mã trường sai hoặc khối không có bữa trong ngày của trường: 404. `gradeId`, `mealType`, ngày sai định dạng: 400.
- **FR-6** Áp dụng giới hạn tần suất chung của `/api`.

### Giao diện

- **FR-7** Bộ chọn ngày và danh sách khối trong ngày (khối, bữa, số lớp, tổng suất, trạng thái). Chặng phát suất ghi tên khối và các lớp trong khối.
- **FR-8** Thẻ tóm tắt có thanh tiến trình 5 chặng (NCC xuất hàng → kiểm nhận → nấu → lưu mẫu → phát suất), mỗi chặng tô màu theo trạng thái xấu nhất.
- **FR-9** Dòng thời gian dọc, mỗi bước có giờ, thông tin, nhãn trạng thái; mở ra để xem dấu vân tay, khối, kết quả kiểm tra, liên kết với bước trước và link Etherscan.
- **FR-10** Trạng thái mỗi bước: nguyên vẹn, đã niêm phong, đang niêm phong, chưa niêm phong được, không kiểm tra được, chưa có bằng chứng, phát hiện thay đổi. Bước bị sửa hoặc đứt liên kết hiện đỏ, tự mở, có banner tóm tắt ở đầu.
- **FR-11** Chưa bấm kiểm tra thì không hiện "nguyên vẹn" từ kết quả cũ lưu trong DB (có thể đã cũ hoặc bị sửa tay); chỉ hiện "đã niêm phong". Kết quả liên kết luôn được tính lại.
- **FR-12** Tên trường dữ liệu bị sửa hiện bằng tiếng Việt (ví dụ `vehiclePlate` → "biển số xe").

## Tiêu chí chấp nhận

- Danh sách và hành trình theo khối; không có lựa chọn theo từng lớp trên giao diện.
- Nhân viên trường A không xem được bữa ăn trường B, kể cả khi truyền `schoolId`.
- Trang công khai không có biển số xe, mã phiếu, mã mẻ, lỗi gửi.
- Gọi kiểm chứng công khai không đổi `verification_status`/`verified_at` trong DB.
- Sửa biển số xe sau niêm phong: bước khai báo NCC và kiểm nhận hiện "phát hiện thay đổi: biển số xe", các bước khác vẫn nguyên vẹn.
