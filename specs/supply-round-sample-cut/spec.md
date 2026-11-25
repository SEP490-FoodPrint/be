# Feature Specification: Cắt lưu mẫu trong mẻ Đợt 1, bù ở Đợt 2, chia mẻ theo nguyên liệu

**Feature Branch**: `feat/supply-round-sample-cut`
**Status**: Đã chốt toàn bộ câu hỏi ngày 25/11/2026 (lịch sử hỏi đáp: `.task_specs/TASK-10-v8-sample-cut-batch2-compensation.plan.md` ở thư mục gốc dự án)
**Thay cho**: phần "lấy thêm" ở Đợt 1 của `specs/supply-round-sample-planning` (D1, D2, D3, D6, D14, D20, D27, mục 6, 7.3, 8.3)

## 1. Bối cảnh

TASK-10 bản đầu bắt cả hai đợt đi chung một quy trình: NCC khai báo lô → hệ thống lập mẻ → kho duyệt → NCC lấy thêm phần lưu mẫu trên từng lô → NCC điền xe. Bản này đổi:

- Đợt 1 không chặn NCC, không có bước kho duyệt hay lấy thêm. Mẻ Đợt 1 chỉ tạo sau khi **mọi nguyên liệu Đợt 1 của ngày** đã giao và kiểm nhận đạt; phần lưu mẫu **cắt thẳng trong mẻ**.
- Đợt 2 bù phần đã cắt (cùng phần lẻ làm tròn) trong tổng lượng đặt; chỉ mẻ mới của Đợt 2 mới lấy thêm như luồng cũ.
- Mẻ chia **theo nguyên liệu** (dùng hết lô, ít mẻ nhất), không theo suất; số suất của mẻ được phép lẻ.

## 2. Quyết định

### Luồng

- **V1, V11, V12** Đợt 1: mẻ của mọi món tạo cùng lúc, tự động, khi mọi chuyến Đợt 1 của ngày `RECEIVED`. Không kho duyệt. Lập lỗi thì kho "Thử lập lại".
- **V2, V18** Phần bù tính trên tổng, không gắn nguồn; Đợt 2 khai báo nguồn tùy ý. Mỗi nguyên liệu có đúng một NCC.
- **V3, V21** Đợt 2 nấu riêng: mẻ trùng mẻ Đợt 1 (cùng khóa nguồn cả mẻ, vd. `ac`) gộp vào mẻ Đợt 1, không lấy thêm mẫu; mẻ khác (`ae`) là mẻ mới và lấy thêm như luồng cũ.
- **V4, V5** Đơn Đợt 2 ghi một tổng = theo suất + bù làm tròn Đợt 1 + bù lưu mẫu Đợt 1. Kho thấy dòng tách; NCC chỉ thấy tổng.
- **V6** Chặn tạo đơn Đợt 2 khi mẻ Đợt 1 chưa tạo.
- **V7, V22, V24, V31** NCC Đợt 2 nấu riêng: 4 bước (Tiếp nhận → Khai báo nguồn cung → Xác nhận đã bổ sung lưu mẫu → Vận chuyển). Bước 3 hiện lượng cần thêm theo nguyên liệu → nguồn/lô ngay khi món chứa nguyên liệu đã lập mẻ; nút xác nhận bật khi mọi nguyên liệu của đơn đã ghép mẻ **và** kho đã duyệt các món đó. Lượng cần thêm = 0 thì tự qua bước 4.
- **V8, V14** Nấu chung: Đợt 1 không cắt mẫu; Đợt 2 tự cộng phần mẫu (mỗi món mỗi bữa 1 mẫu) vào tổng; không kho duyệt, không bước xác nhận; NCC 3 bước ở cả hai đợt. Phần mẫu gán khi phần Đợt 2 gộp vào mẻ.
- **V9, V16** Gia vị và đồ khô: cắt ở Đợt 1, bù ở Đợt 2 bằng giữ thêm từ kho; kho thiếu thì chặn mẻ lên "Chính thức".
- **V10** Dòng Đợt 2 trong danh sách phiếu nhập có nút "Xác nhận lưu mẫu" (cạnh "Chi tiết") mở trang Kế hoạch mẻ đúng ngày, Đợt 2.
- **V13, V19, V20** "Đợt 2 không cần": `đặt Đợt 1 − phần mẫu (đã cắt hoặc cần lấy) ≥ cần theo sĩ số thực tế` cho mọi nguyên liệu, cùng điều kiện theo khối hiện có. Nấu chung thỏa thì cắt mẫu từ mẻ Đợt 1. Kết luận chỉ khi đã chốt điểm danh **và** đã có mẻ Đợt 1.
- **V15** Không cho sửa số lượng ở đơn của cả hai đợt; BE tự tính lại và từ chối số khác.
- **V17** Bước 3 của NCC chỉ có nút "Tải lại trạng thái".
- **V29, V32** Bếp dùng thẳng mẻ của luồng đợt giao; gỡ lập mẻ thủ công.
- **V33** Món chỉ dùng đồ khô: tạo mẻ Đợt 1 cùng các món khác, có cắt mẫu; Đợt 2 bù từ kho.
- **V34** Ngày không có đồ tươi: tạo mẻ khi lớp cuối chốt điểm danh; mỗi món mỗi bữa một mẻ; mẫu giữ thẳng từ kho; không có Đợt 2.

### Chia mẻ

- **V23, V25** Mẻ ghép các nhóm nguồn của các nguyên liệu tươi trong món, dùng hết lô của đợt, ít mẻ nhất: ghép nhóm có "suất tương đương" bằng nhau trước, rồi quét song song. Đồ khô không tách mẻ, lấy theo suất từ kho.
- **V26** Số suất mẻ là `numeric(20,2)`, chia theo tỉ lệ lượng, làm tròn 0,01 theo phần dư lớn nhất.
- **V27** Lô dùng cho nhiều bữa/món chia theo tỉ lệ nhu cầu trước khi ghép.
- **V28, V36** Mẻ nhỏ hơn phần mẫu cần cắt gộp vào mẻ chung nguồn.
- **V30** Đợt 2: phần dư do lệch tỉ lệ cộng vào mẻ cuối cùng nguồn.
- **V35** Đợt 1 nấu riêng: phần dư do lệch tỉ lệ tách sang `supply_round_leftovers` (giữ chỗ), dùng làm tồn ở Đợt 2 của cùng món/bữa (cùng nguồn thì gộp nhóm, khác nguồn là nguồn độc lập). Mẻ Đợt 2 có phần dư thì cắt mẫu trong mẻ.
- **V37** Đợt 2 không cần: phần dư không vào mẻ, hiển thị "Thừa từ Đợt 1".

## 3. Dữ liệu (expand-only)

1. `planned_portions` → `numeric(20,2)` ở `cooking_batches`, `cooking_batch_dishes`, `cooking_batch_round_parts` (CHECK của phần Đợt 2 nới thành `>= 0`).
2. Enum `sample_strategy` (`CUT`, `TOP_UP`, `ROUND2_ORDER`, `STOCK`) + `cooking_batches.sample_strategy`.
3. Enum `supply_compensation_kind` + bảng `supply_round_compensations`.
4. Bảng `supply_round_leftovers`.
5. `supply_request_items.carry_over_quantity`, `sample_compensation_quantity` (chỉ để kho xem).
6. `cooking_batch_round_part_lots.sample_quantity` (nới CHECK `quantity_used`).

## 4. Ngoài phạm vi / hạn chế đã biết

- NCC khai báo chậm ở Đợt 1 làm chậm cả Đợt 2 (V11 chấp nhận).
- Phần mẫu khi Đợt 2 có khối thiếu suất nhưng món không có suất Đợt 2 (`portions = 0`) không được tính lại.
