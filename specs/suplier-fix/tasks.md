# Tasks

- [x] T001 Cảnh báo đồ lưu kho: yêu cầu nhập đã gửi bù mọi ngày (không chờ ngày giao), lô trong kho dùng trước phần đã đặt, đơn bị hủy thì cảnh báo hiện lại; cập nhật `tests/warehouse-stock-alerts.test.ts` (FR-001).
- [x] T002 Lọc ngày danh sách kiểm tra giao hàng: `requestedDeliveryDate` chỉ là dự phòng khi xe chưa có giờ hẹn / giờ đến tại `src/modules/delivery/delivery.repository.ts` (FR-002).
- [x] T003 Migration `20261128000100_class_allergy_groups` và cập nhật `prisma/schema.prisma`, giữ dữ liệu cũ thành nhóm 1 (FR-003).
- [x] T004 Thuật toán nhóm dị ứng trong `src/utils/allergy-match.ts` và test kịch bản A: 1, B: 1, A + B: 1 (FR-003).
- [x] T005 Meal-attendance: lưu nhóm dị ứng lớp, báo suất theo nhóm, chia nhóm suất theo nhóm; cập nhật `tests/meal-submission.test.ts` (FR-003).
- [x] T006 Kitchen, meal-allocation, menu, allergy đọc và cộng theo nhóm; cập nhật test liên quan; chạy `npm run test:unit`, typecheck, format (FR-003).
