# Spec: Mốc chuẩn món ăn và khẩu phần theo khối

Phạm vi của nhánh bao gồm [tỷ lệ hao hụt nguyên liệu](ingredient-waste-rate/spec.md). Định lượng thành phẩm được tính theo khẩu phần từng khối trước khi quy thành lượng sống cho đặt hàng và lập mẻ.

Nguồn yêu cầu đã chốt: `.task_spec/TASK-dish-standard-portion.md` ở repo gốc (chốt ngày 2026-11-24).

## Bối cảnh

Hiện mỗi món lưu định lượng "1 suất" và chép nguyên định lượng đó vào từng khối (`dish_grade_recipe_lines`). Trường muốn mỗi món có **một mốc chuẩn** (ví dụ 100 g gà xào nấm gồm 60 g gà, 30 g nấm, 2 g muối). Khi áp dụng cho khối, trường chỉ nhập **khẩu phần** của khối; định lượng từng nguyên liệu được tính theo tỉ lệ.

## Yêu cầu chức năng

- **FR-001**: `dishes` thêm `standard_quantity DECIMAL(14,3)` và `standard_unit VARCHAR(30)` (chỉ `g` hoặc `ml`); `dish_grade_recipes` thêm `portion_quantity DECIMAL(14,3)`, đơn vị luôn là `dishes.standard_unit`. Các cột mới **nullable** trong giai đoạn này (dữ liệu cũ chưa chuyển).
- **FR-002**: `dish_ingredient_entries.required_quantity` + `unit` là lượng nguyên liệu/gia vị **trong mốc chuẩn**, không còn là "1 suất".
- **FR-003**: Định lượng 1 suất của khối = `required_quantity × portion_quantity / standard_quantity`, làm tròn 3 chữ số thập phân `ROUND_HALF_UP` ngay sau khi nhân. Kết quả bằng 0 sau làm tròn là lỗi 422. Thực đơn toàn trường dùng tỉ lệ 1. Công thức nằm trong helper chung `src/utils/dish-portion.ts`; mọi module đọc định lượng theo khối phải dùng helper này.
- **FR-004**: Validate mốc chuẩn. S = tổng `required_quantity` của **mọi dòng (MAIN và SEASONING)** có `unit` trùng `standard_unit` (so sánh chuỗi đã chuẩn hóa, không quy đổi đơn vị):
  - mọi dòng cùng đơn vị mốc chuẩn: `standard_quantity ≥ S`;
  - có dòng cùng đơn vị và có dòng khác đơn vị: `standard_quantity > S`;
  - không dòng nào cùng đơn vị: `standard_quantity > 0`.
    Validate ở BE (nguồn chuẩn) và FE.
- **FR-005**: `portion_quantity > 0`, không giới hạn trên. Khi lưu món, BE chỉ upsert các khối được gửi; khối khác giữ nguyên.
- **FR-006**: API ghi món (`POST/PUT /api/dishes`) nhận `standardQuantity`, `standardUnit`, `lines` (công thức mốc chuẩn) và `gradeRecipes: [{ gradeId, portionQuantity }]`. Response trả `standardQuantity`, `standardUnit`, `gradeRecipes[].portionQuantity` và `gradeRecipes[].lines` đã tính sẵn cho khối.
- **FR-007**: Thực đơn theo khối, xem trước công thức, bản chụp công thức khi lập mẻ (`allocationRecipeSnapshot`), phân bổ nguyên liệu cho lớp, nhu cầu đặt đồ tươi, trang thực đơn công khai và script seed đều tính định lượng theo FR-003. Không module nào đọc hoặc ghi `dish_grade_recipe_lines`.
- **FR-008**: Món thiếu mốc chuẩn hoặc khối thiếu khẩu phần: luồng thực đơn báo 422 rõ ràng ("chưa có mốc chuẩn" / "chưa có khẩu phần cho khối"), không đoán giá trị, không fallback sang `dish_grade_recipe_lines`.
- **FR-009**: Thực đơn nhiều khối mà khẩu phần khác nhau vẫn báo "hãy tách thực đơn"; so sánh theo định lượng đã tính.

## Migration giai đoạn này

- Chỉ thêm cột nullable + CHECK (`> 0`, đơn vị `g`/`ml`, cặp quantity/unit cùng null hoặc cùng có giá trị).
- Giữ nguyên bảng `dish_grade_recipe_lines` và dữ liệu, chỉ đánh dấu DEPRECATED. Không DROP, không UPDATE/DELETE dữ liệu, không NOT NULL.

## Ngoài phạm vi

- Script chuyển dữ liệu cũ (người dùng tự chạy sau).
- Drop `dish_grade_recipe_lines` và `SET NOT NULL` (đợt sau, xem task gốc mục 6).
- Quy đổi đơn vị trong công thức món (g↔kg, ml↔l).
- Không đổi bản chụp đã lưu của thực đơn (`menu_day_dish_ingredients`, `menu_meal_seasonings`) hay mẻ nấu.

## Bổ sung đợt dọn dẹp (2026-11-24, sau khi chuyển dữ liệu)

- **FR-010**: Chỉ dòng công thức dùng đơn vị khối lượng/thể tích (g, mg, kg, ml, l) được nhân theo tỉ lệ khẩu phần. Dòng dùng đơn vị đếm (quả, hộp, cái, phần, miếng, suất, chai…) giữ nguyên số lượng đã khai báo cho mọi khối (ví dụ 1 quả trứng không thành 0.8 quả).
- **FR-011**: Migration `20261206000100_dish_standard_portion_cleanup`: dừng nếu còn món thiếu mốc chuẩn hoặc khối thiếu khẩu phần; đặt `NOT NULL` cho `dishes.standard_quantity`, `dishes.standard_unit`, `dish_grade_recipes.portion_quantity`; bỏ CHECK cặp null; `DROP TABLE dish_grade_recipe_lines`.
- **FR-012**: Bỏ các nhánh xử lý dữ liệu cũ thiếu mốc chuẩn/khẩu phần ở BE/FE. Thực đơn không còn tự tạo món chỉ từ tên (món phải có mốc chuẩn); tên món chưa có trong danh mục trả 422.
