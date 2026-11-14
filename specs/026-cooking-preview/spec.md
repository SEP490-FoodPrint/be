# Xem trước phương án chế biến

Nhân viên bếp xem phương án thật của toàn bữa trước khi tạo. GET preview không tạo mẻ hoặc giữ kho. POST tính lại và tạo mẻ đang nấu (CONFIRMED). Kho thay đổi có thể làm phương án khác; người dùng cần xem lại trước khi tạo. Trạng thái lịch sử không thay đổi.

## Hợp đồng và tiêu chí

- GET `/api/v1/kitchen/plan` nhận `menuDayId`, `mealType` và `dishId` tùy chọn, kiểm tra quyền `cooking_batch.create` và phạm vi trường hiện hành.
- Trả `batches` theo mẻ/món/lô nguồn, `seasonings` cho cả bữa, `cookingModeApplied` và `planVersion`. Không cấp mã mẻ trước khi tạo.
- GET chỉ tính và đọc. POST khóa tồn kho, tính lại cùng quy tắc, kiểm tra `planVersion` nếu được gửi; khác phiên bản trả 409 và không ghi mẻ.
- FE luôn gửi phiên bản đã xem. API vẫn chấp nhận caller cũ không gửi phiên bản để tương thích.
- Mẻ mới có `CONFIRMED`, thời gian và người xác nhận ngay khi tạo; tiêu hao kho vẫn chỉ ghi khi hoàn thành, có tính lặp an toàn.
- Popup giữ nguyên khi tạo lỗi và yêu cầu tải lại phương án. Không cho xác nhận khi đang tải, bị lỗi hoặc không còn nhu cầu.
- Tiến độ bỏ bước Bắt đầu nấu, hiển thị Đang nấu và chỉ cho Nấu xong với CONFIRMED. Dữ liệu UNCONFIRMED cũ giữ nguyên lịch sử và không bị giả định đã nấu.
