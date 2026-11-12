# Kiểm tra phân bổ ngày 12/11/2026

Dùng PostgreSQL local dành riêng cho kiểm thử đã áp dụng schema hiện tại. Chọn trường test chưa có thực đơn tuần 09/11 và tài khoản bếp cùng giáo viên chủ nhiệm đang hoạt động tại trường đó.

```powershell
$env:MEAL_ALLOCATION_FIXTURE_DATABASE_URL = '<URL PostgreSQL local của DB test>'
npm run fixture:meal-allocation -- <schoolId> <kitchenId> <teacherId> cooking
npm run fixture:meal-allocation -- <schoolId> <kitchenId> <teacherId> samples
npm run fixture:meal-allocation -- <schoolId> <kitchenId> <teacherId> ready
```

- Chạy từng lệnh riêng và mở lại màn Phân bổ sau mỗi lần. `cooking` khóa với nút đến trang nấu, `samples` hiển thị 60/100 suất và nút đến trang lưu mẫu, `ready` mở phân bổ ở 100/100.
- Fixture mô phỏng trạng thái của lô và mẫu bằng dữ liệu test. Dùng lệnh chuyển trạng thái fixture để kiểm từng màn.
- Ngày ăn luôn là 12/11/2026. API runtime dùng ngày hiện tại theo giờ Việt Nam. Suite tích hợp truyền đồng hồ cố định ở cấp service.
- Ở trạng thái `ready`, phân lô 60 suất cho 5A 40 và 5B 20, lô 40 suất cho 5B 15 và 5C 25. Áp dụng một lần và tải lại. Nếu muốn chuyển fixture về trạng thái khóa, gỡ các phân bổ trước.
