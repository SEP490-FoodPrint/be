# Kiểm chứng

- Kiểm kê read-only DB ứng dụng: 11 ký hiệu đang dùng; `lít` nối alias về `l`, số lượng và chuỗi lịch sử giữ nguyên.
- 843 unit test BE qua với `BLOCKCHAIN_ENABLED=false` cho fixture và concurrency 2 để hạn chế bộ nhớ. Test mới kiểm tra validation, mã bất biến, độ chính xác và quyền trước khi kết nối DB.
- Regression FE: 7 test qua, gồm bước 0.1/0.5/0.25/1, không gợi ý 0, BigInt chính xác và bảo toàn logic phân bổ cũ.
- Cloud integration dùng DB tạm riêng: migration/backfill `lít`, đơn vị lạ OTHER bước 0.001, công thức 0.650 giữ nguyên; API đọc cho trường/NCC, 401 chưa đăng nhập, 403 ghi ngoài System Admin, trùng alias 409 rollback, inactive và quyền bị thu hồi được kiểm lại.
- Edge headless 390px: admin lưu bước 0.25, mã/ký hiệu bị khóa khi sửa; nhập 10.52 kg cảnh báo 10.5/10.6, nút Tạo vẫn hoạt động và callback nhận nguyên 10.52. Hai trang có clientWidth=scrollWidth=390; nút Tạo cao 44px. Đã xem screenshot và chỉnh cảnh báo đủ rộng để đọc.
- Build FE/BE đã qua. `npm run validate` qua lint và dừng ở format toàn repo; các file sửa được kiểm tra format riêng, không reformat toàn repo.
- Đã áp migration và cấp quyền trên DB ứng dụng sau phê duyệt riêng ngày 2026-11-21.

- Kết quả cuối: 6/6 integration cloud (gồm bootstrap chọn riêng), 843/843 unit BE, 7/7 regression FE, Prisma validate và build FE/BE qua. ESLint phần sửa qua. Format toàn repo phát hiện 439 file; package.json thuộc phạm vi đã sửa format riêng, các lỗi còn lại nằm ngoài phạm vi.
- Preflight DB ứng dụng: chỉ pending 20261126000100_measurement_units, không có checksum lệch. Chưa có registry hoặc quyền mới. Bootstrap toàn catalog còn có thể thêm food_safety_report.receive, nên chỉ dùng --permission-code=measurement_unit.manage.

## Kết quả triển khai DB ứng dụng — 2026-11-21

Sau khi người dùng duyệt, preflight phát hiện migration complaint_supertype vừa được áp dụng từ PR #172. Fetch origin, khôi phục duy nhất file lịch sử 20261126000100_complaint_supertype từ origin/dev; SHA-256 aa9e025fc3204f353d87b9befcf8cf339f81c2138d279f1710cda5e10741f117 khớp DB. Không sửa lịch sử DB hoặc merge code complaint vào tính năng này.

Prisma migrate deploy chỉ áp dụng 20261126000100_measurement_units. Bootstrap chọn riêng measurement_unit.manage thêm đúng 1 permission và 1 grant cho SYSTEM_ADMIN; không thêm food_safety_report.receive hoặc sửa permission/grant có sẵn.

Kết quả: 24 đơn vị; 133/133 nguyên liệu liên kết, 0 thiếu. kg/l bước 0.100, g/ml 1.000, quả 0.500, miếng 1.000. Hash của 13 bảng nghiệp vụ trước/sau giữ nguyên khi loại duy nhất cột unit_id mới của ingredients; số lượng, chuỗi đơn vị và lịch sử cũ không đổi.
