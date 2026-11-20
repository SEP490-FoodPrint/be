# Kết quả kiểm chứng

- Người dùng đã yêu cầu kiểm thử cloud thay local và sau đó cho phép áp dụng riêng migration `20261125000100_meal_allocation_materials` vào DB ứng dụng.
- Hai lần chạy tạo DB cloud tạm riêng, chạy toàn bộ lịch sử migration và integration, rồi xóa đúng DB do lần chạy đó tạo sau khi kiểm tra quyền sở hữu. DB ứng dụng chỉ được thay đổi ở bước migration đã được cho phép.
- Lần integration cuối có 8 test qua, gồm numeric(20,2), lưu 16.67/33.33 với 1000g/2000g rồi rollback, chia 2.4kg/4.8kg theo hai khối, HTTP preview/apply, request đồng thời 200/409, số suất chuỗi, xác nhận cả ngày, proof phiên bản 2 và khóa nguồn đã giao.
- 826 unit tests qua khi đặt BLOCKCHAIN_ENABLED=false trong tiến trình test. Các test proof có cấu hình và mock riêng. Bốn lỗi chế biến trước đó do cấu hình local bật blockchain trên DB giả.
- Build FE/BE, Prisma validate và typecheck đã qua. npm run validate toàn repo dừng ở format check, ghi nhận 436 file trước khi bổ sung các file integration cuối.
- Edge headless 390px với dữ liệu kiểm thử có clientWidth=scrollWidth=390, nút Tính và Áp dụng cao 44px, hiển thị 16,67/33,33 và tổng 50,00; xem trước và callback áp dụng qua.
- Kiểm tra migration history DB ứng dụng cho thấy chỉ migration mới còn pending. Deploy thành công và xác minh numeric(20,2) cùng hai FK của bảng nguyên liệu phân bổ.

## Chạy lại integration cloud

`npm run test:material-allocation:cloud` dùng DATABASE_URL cloud từ cấu hình. Runner tạo DB ngẫu nhiên có prefix riêng, truyền tên DB sở hữu vào test, và chỉ dọn DB đã tạo trong chính lần chạy. Không chạy test tích hợp trực tiếp trên dữ liệu ứng dụng.

Lô lịch sử thiếu allocationRecipeSnapshot tiếp tục dùng luồng cũ. Phương án nguyên liệu yêu cầu bản chụp được tạo cùng lô mới; không suy diễn định lượng cho lịch sử.

## Sửa bộ đếm nhánh cũ theo ảnh 617 suất

- FE hiển thị số suất lô cấp / nhu cầu riêng của khối. Dữ liệu 254 và 363 hiện thành 254,00/254,00 và 363,00/363,00, nhãn Đã cấp / Cần.
- Lượng dư chung tính từ toàn bộ khối. Bản nháp được gộp theo lô–món và lọc lại theo khối khi hiển thị, tránh chỉnh một khối làm mất khối khác.
- Hộp chọn lớp trừ phần lớp đã nhận từ các lô khác và giới hạn theo dung lượng sau phần của khối khác. Tính xem trước bằng đơn vị 0,01 suất.
- 5 test FE qua. Edge headless trên toàn màn hình với hai món, 8 lớp và 12 lớp xác nhận đủ bốn bộ đếm đúng; chiều rộng 390px không tràn ngang và mở một lô không mở theo lô của khối khác.

## Điều chỉnh tự động mặc định qua API hiện hữu

- GET theo bữa tự lập phương án khi chưa có dòng phân bổ lưu; GET không ghi dữ liệu. PUT lưu qua revision/planId, không còn POST tính riêng hoặc nút Tính phân bổ.
- Lô cũ dùng định lượng thực đơn/công thức khối nếu thiếu snapshot; revision bao gồm định lượng đã tra, dòng nguyên liệu lưu định lượng thực áp dụng. Không đổi lịch sử hoặc thêm migration.
- 827 unit test BE qua (BLOCKCHAIN_ENABLED=false trong môi trường mock), 5 regression FE về Decimal/khối/lớp qua. Build FE và BE qua.
- Cloud integration: 9/9 qua trên DB tạm được tạo riêng, kiểm tra GET lô cũ, nguồn theo khối, không ghi trên GET, không tính đè dữ liệu đã lưu, PUT đồng thời 200/409, giao cả ngày và proof v2. Đã dọn đúng DB tạm, không ghi dữ liệu thử lên DB ứng dụng.
- Edge headless mobile: 390px, scrollWidth=390px, phương án 16,67 + 33,33 tự xuất hiện, không có nút tính, nút áp dụng cao 44px và thao tác áp dụng qua service PUT thành công.

- Kiểm tra cuối: ESLint phần sửa qua; npm run validate qua lint rồi dừng tại format:check với 433 file toàn repo. Không reformat hàng loạt các file ngoài phạm vi. Typecheck/build BE đã chạy riêng và qua.
