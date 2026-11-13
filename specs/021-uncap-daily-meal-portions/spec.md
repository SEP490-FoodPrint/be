# Feature Specification: Bỏ giới hạn trần suất ăn bán trú và sắp xếp lịch sử theo ngày

**Feature Branch**: `feat/021-uncap-daily-meal-portions`  
**Status**: Implemented  
**Liên quan**: spec 015, spec 016, meal-attendance module

## User story

Giáo viên chủ nhiệm (GVCN) khi khai báo số suất ăn bán trú hằng ngày cho lớp cần linh hoạt vì thực tế thường xuyên có thêm học sinh đăng ký ăn bán trú phát sinh (chưa đăng ký từ đầu năm). Hệ thống không được chặn cứng tổng số suất ở mức số suất đăng ký đầu năm (`registeredMealPortions`), mà coi số suất đầu năm là mốc tham chiếu. Đồng thời, danh sách lịch sử khai báo của lớp phải được sắp xếp theo ngày giảm dần và ca ăn để GVCN dễ theo dõi theo tuần/tháng.

## Functional requirements

- **FR-001**: GVCN MUST được phép lưu nháp và chốt số suất ăn (`totalPortions`) lớn hơn số suất đăng ký đầu năm của lớp (`registeredMealPortions`). Backend không ném lỗi 422 khi `totalPortions > registeredMealPortions`.
- **FR-002**: `totalPortions` vẫn MUST là số nguyên không âm (≥ 0).
- **FR-003**: Số suất dị ứng (`allergy.portionCount`) vẫn MUST nằm trong tổng số suất (`totalPortions`) và không vượt số lượng học sinh có hồ sơ dị ứng của lớp (`master.affectedCount`).
- **FR-004**: API `GET /api/meal-portions` (danh sách lịch sử suất ăn) MUST sắp xếp theo `mealDate` giảm dần (mới nhất lên đầu), tiếp theo là `mealType` tăng dần, sau đó là `id` giảm dần.

## Acceptance scenarios

1. GVCN của lớp có `registeredMealPortions = 30` lưu nháp hoặc chốt 36 suất ăn: hệ thống lưu thành công, trả ID bản ghi.
2. Danh sách `GET /api/meal-portions` trả về các bản ghi sắp xếp theo thứ tự ngày giảm dần.

## Constraints and edge cases

- Không thay đổi Prisma schema, không migration cơ sở dữ liệu.
- Giữ nguyên các ràng buộc phân quyền theo trường và niên khóa.
