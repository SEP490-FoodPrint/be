# Công việc

## T1. API nội bộ

- [x] `mealSubjects` gộp các lớp, trả `meal` và `steps`, kể cả bước chưa có bằng chứng
- [x] `GET /chains/grade-meals?date=` và `GET /chains/grade-meals/:gradeId` theo phạm vi trường
- [x] Test: phạm vi trường, `schoolId` chỉ dùng cho tài khoản hệ thống, `none` cần trường, thiếu quyền 403, trạng thái chung

## T2. API công khai

- [x] `findPublicSchool`, `publicGradeMeals`, `publicGradeChain`
- [x] `publicView` ẩn biển số, mã phiếu, mã mẻ, lỗi gửi
- [x] Kiểm chứng công khai không gọi `setVerification`
- [x] Test: ẩn trường, không lưu, mã trường sai 404, khối không thuộc trường 404, blockchain tắt 409

## T3. FE

- [x] Service, adapter và test (`npm run test:blockchain-proof`)
- [x] Component dùng chung và hai trang
- [x] Route, menu nội bộ, mục trên header trang trường
- [x] `npm run build`

## T4. Kiểm tra thật

- [x] Trên DB clone: tạo một bữa đã phát, neo 5 bằng chứng lên Sepolia, xem trang nội bộ
- [x] Sửa biển số xe: hai chặng giao hàng báo thay đổi, các chặng khác nguyên vẹn
- [x] Gọi API công khai: trường bị ẩn, `verified_at` trong DB không đổi
- [x] Theo khối: lớp chưa xếp khối hiện "Chưa xếp khối"; gán khối trên DB clone thì danh sách và hành trình hiện đúng khối
