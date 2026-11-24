# Spec: Tỷ lệ hao hụt nguyên liệu theo cấu hình của trường (TASK-09)

Nguồn yêu cầu đã chốt: `.task_specs/TASK-09-ingredient-waste-rate.md` ở repo gốc (mục 9 có câu trả lời Q1–Q7).

## Bối cảnh

Định lượng món đang được coi là 1 g nguyên liệu sống ra 1 g thành phẩm. Trường cần cấu hình tỷ lệ hao hụt `r` (0 <= r < 1) cho từng nguyên liệu để tách ba phần: dinh dưỡng chỉ quản lý định lượng thành phẩm, kho chỉ thấy tổng lượng sống cần nhập, còn bếp dùng cả hai (lượng sống để lấy lô và trừ kho, thành phẩm để phân bổ cho lớp).

## Yêu cầu chức năng

- **FR-001**: `ingredient_entries.waste_rate DECIMAL(5,4) NOT NULL DEFAULT 0`, có CHECK `0 <= waste_rate < 1`. Không lưu lịch sử thay đổi. Áp dụng cho mọi nguyên liệu trong công thức món (đồ tươi và đồ lưu kho như gạo, đậu); gia vị dùng chung của bữa (`menu_meal_seasonings`) luôn tính 1-1.
- **FR-002**: `requiredQuantity` / `quantityPerPortion` của công thức và thực đơn là **định lượng thành phẩm cho 1 suất**. Lượng sống = thành phẩm / (1 − r); thành phẩm = sống × (1 − r). Công thức nằm trong một helper chung `src/utils/waste-rate.ts`.
- **FR-003**: Quyền mới `ingredient_waste_rate.manage`, cấp cho `SCHOOL_KITCHEN_STAFF`. `GET /api/ingredient-entries/waste-rates` liệt kê nguyên liệu ACTIVE của trường kèm `wasteRate`; `PATCH /api/ingredient-entries/:ingredientEntryId/waste-rate` nhận `{ wasteRate }` (số, 0 <= r < 1, tối đa 4 chữ số thập phân). Phạm vi lấy từ trường của tài khoản; nguyên liệu ngoài trường trả 404.
- **FR-004**: Nhu cầu đặt đồ tươi (`fresh-demand`) tính theo lượng sống, Đợt 2 dùng tỷ lệ hiện tại. Chi tiết theo món không hiển thị tỷ lệ hao hụt; `quantityPerPortion` của chi tiết vẫn là thành phẩm.
- **FR-005**: Cảnh báo tồn kho đồ lưu kho và bảng nhu cầu–tồn kho của thực đơn bếp tính dòng món theo lượng sống, gia vị chung 1-1.
- **FR-006**: Lập mẻ nấu lấy lô theo lượng sống. Lượng lấy từ mỗi lô được làm tròn lên ở 3 chữ số thập phân (độ chính xác `numeric(14,3)`) để không thiếu hàng; phần làm tròn không vượt lượng còn trống của lô. Response chi tiết mẻ và xem trước phương án trả thêm `cookedQuantity` = `quantityUsed × (1 − r)`.
- **FR-007**: Phân bổ nguyên liệu cho lớp quy lượng sống của lô về thành phẩm bằng tỷ lệ hiện tại trên `IngredientEntry`. Nhu cầu của lớp giữ `thành phẩm/suất × số suất`. Lượng đã khóa vượt lượng sống của lô mới là lỗi lịch sử; nếu tỷ lệ tăng sau khi khóa thì thành phẩm còn lại về 0.
- **FR-008**: Truy xuất và payload blockchain không thêm trường hao hụt. `allocationRecipeSnapshot` không lưu tỷ lệ.

## Ngoài phạm vi

- Không lưu lịch sử thay đổi tỷ lệ, không snapshot tỷ lệ vào mẻ nấu hay đơn đặt.
- Không đổi cách làm tròn lượng đặt hàng của TASK-08 (giữ 6 chữ số khi tính, Đợt 1 làm tròn xuống như cũ).
