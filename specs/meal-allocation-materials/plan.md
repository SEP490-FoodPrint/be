# Kế hoạch

Thêm migration Decimal, snapshot công thức và chi tiết nguồn cấp. Bộ lập phương án độc lập dùng Decimal, solver mixed-integer và kiểm tra lại. GET hiện hữu tự lập phương án theo bữa chưa phân bổ; PUT hiện hữu lưu với revision/plan hash bao trùm nguồn và định lượng. FE hiển thị phương án do server tính.

## Constitution Check

I Controller/validation/service/repository riêng, DTO suy ra từ Zod và response allowlist. II School từ principal, quyền view/update/create. III Migration mới, kiểm thử local, không sửa lịch sử migration. IV Ghi và kiểm tra lại trong cùng transaction trường. V Decimal serialize chuỗi, không trả record thô. VI Spec này mở rộng 014/015 và meal-allocation-by-meal. VII Không thêm mã nghiệp vụ.

Bổ sung: tích hợp lập phương án vào GET hiện hữu, lưu qua PUT hiện hữu; bỏ API và nút tính riêng. Lô cũ tra định lượng theo thực đơn/khối và kiểm tra nguồn, không cần migration mới.
