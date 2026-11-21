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

- (Đã thay bởi TASK-07, xem cuối tệp) GET theo bữa chỉ đọc nháp hoặc bản đã áp dụng; phương án do tác vụ nền tạo. PUT dùng `revision` và các dòng đã chỉnh, không còn `planId`, POST tính riêng hoặc nút Tính phân bổ.
- Lô cũ dùng định lượng thực đơn/công thức khối nếu thiếu snapshot; revision bao gồm định lượng đã tra, dòng nguyên liệu lưu định lượng thực áp dụng. Không đổi lịch sử hoặc thêm migration.
- 827 unit test BE qua (BLOCKCHAIN_ENABLED=false trong môi trường mock), 5 regression FE về Decimal/khối/lớp qua. Build FE và BE qua.
- Cloud integration: 9/9 qua trên DB tạm được tạo riêng, kiểm tra (kết quả trước TASK-07; kịch bản GET tự tính và PUT `planId` nay được viết lại cho luồng nháp nền và chưa chạy lại), giao cả ngày và proof v2. Đã dọn đúng DB tạm, không ghi dữ liệu thử lên DB ứng dụng.
- Edge headless mobile: 390px, scrollWidth=390px, phương án 16,67 + 33,33 tự xuất hiện, không có nút tính, nút áp dụng cao 44px và thao tác áp dụng qua service PUT thành công.

- Kiểm tra cuối: ESLint phần sửa qua; npm run validate qua lint rồi dừng tại format:check với 433 file toàn repo. Không reformat hàng loạt các file ngoài phạm vi. Typecheck/build BE đã chạy riêng và qua.

## TASK-07: phương án nền và bản nháp chỉnh sửa

- Luồng: lưu mẫu xếp hàng tác vụ trong cùng giao dịch → worker tính GLPK ngoài giao dịch rồi ghi `DRAFT` nếu nguồn không đổi → GET chỉ đọc → Lưu bản nháp và Áp dụng dùng chung `buildMaterialPlan` ở chế độ chỉnh (không gọi solver) và `revision`.
- Đã gỡ nhánh PUT `planId`, `createMaterialAllocationService().preview` và `apply` cũ; body có `planId` bị từ chối 400. `retry` kiểm tra quyền trước khi kết nối.
- Test unit mới `tests/material-allocation-draft.test.ts` (trong `test:unit`): hai lần lưu mẫu đồng thời chỉ một tác vụ; bữa trưa và bữa xế độc lập; bữa đã có phân bổ không xếp hàng; worker ghi `DRAFT` đúng `sourceRevision`; kết quả từ dữ liệu cũ quay về `PENDING` và không ghi đè; phân bổ hoặc nháp tạo trong lúc tính được giữ; lỗi solver thành `FAILED` kèm lý do; mở trang không ghi và không gọi solver; payload chỉ nhận chuỗi thập phân.
- Test FE mới `tests/allocation-draft.test.mjs`: đổi thứ tự hoặc `28`/`28.00` không bật Lưu bản nháp; đổi lô hoặc số suất bật; hoàn tác thì tắt.
- Kịch bản tích hợp (GET không queue, worker tạo nháp, PUT đồng thời 200/409, bữa đã giao từ chối nháp và áp dụng) đã viết trong `material-allocation.integration.test.ts` nhưng cần DB tạm riêng, chưa chạy trong lần sửa này.
- Chưa có test tự động cho: 409 khi hai người lưu nháp cùng revision, áp dụng đồng thời với xác nhận giao. Hai ca này dựa vào khóa hàng trường trong `withSchoolTransaction` và cần test tích hợp.
