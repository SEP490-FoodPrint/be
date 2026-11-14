# Kế hoạch

Chuẩn hóa Unicode, chữ hoa và khoảng trắng, ánh xạ cách viết rõ nghĩa sang đơn vị chuẩn, sau đó tiếp tục quy đổi bằng Decimal theo nhóm khối lượng/thể tích. Các đơn vị không có quy đổi vẫn chỉ so khớp khi giống nhau. Giữ nguyên kiểm tra độ chính xác lưu kho hiện có.

## Constitution Check

- I: thay đổi logic dùng chung, không thêm truy vấn hoặc thay đổi API.
- II: giữ nguyên phân quyền và phạm vi trường.
- III: không sửa schema, migration hoặc dữ liệu.
- IV: giữ nguyên transaction và kiểm tra tồn kho.
- V: giữ HTTP 409 và thông báo lỗi rõ ràng.
- VI: spec, plan và tasks nằm cùng nhánh `fix/028-ingredient-unit-conversion`.

Kiểm thử quy đổi, phân bổ mẻ và so sánh công thức theo khối; chạy lint, typecheck, build và test unit phù hợp.
