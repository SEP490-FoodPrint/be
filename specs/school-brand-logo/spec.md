# Feature Specification: Logo trường trên giao diện nhân sự nhà trường

**Branch**: `feat/school-brand-logo` | **Nhánh gốc**: `dev` | **Date**: 2026-11-21

## Bối cảnh

Khi nhân sự nhà trường đăng nhập (Quản trị nhà trường, BGH, GVCN, bếp, kho…), góc trái sidebar đang hiện logo và tên nền tảng FoodPrint. Tên trường lấy từ một giá trị cứng ở frontend, vì `/auth/me` không trả tên trường. Bảng `schools` đã có cột `logo_url` nhưng chưa có API nào để trường tự cập nhật cột này.

## User Stories

### P1: Nhân sự trường thấy logo và tên trường của mình

Là nhân sự nhà trường, tôi muốn sidebar hiện logo và tên trường mình đang làm việc, để nhận ra ngay mình đang thao tác trong trường nào.

1. Tài khoản thuộc trường gọi `GET /api/schools/me/brand` và nhận về `{ schoolId, name, logoUrl }` của trường trong phiên.
2. Tài khoản không thuộc trường nào (NCC, System Admin, đơn vị ATTP) nhận 403.
3. Trường chưa có logo thì `logoUrl` là `null`; frontend dùng logo FoodPrint thay thế.

### P1: Quản trị nhà trường đổi logo

Là Quản trị nhà trường, tôi muốn tải lên hoặc gỡ logo của trường, để mọi nhân sự trong trường đều thấy logo đó.

1. `PUT /api/schools/me/logo` với multipart có đúng một tệp ở trường `logo` (JPEG, PNG hoặc WebP, tối đa 5 MiB): ảnh được lưu lên Cloudinary, `logo_url` được cập nhật, API trả về thông tin trường mới.
2. `DELETE /api/schools/me/logo`: `logo_url` về `null`.
3. Tài khoản thiếu quyền `school.manage`, hoặc không phải `SCHOOL_ADMINISTRATION` của một trường, nhận 403 trước khi tệp được đọc hay tải lên.
4. Yêu cầu không phải multipart, thiếu tệp, thừa trường hoặc sai định dạng ảnh nhận 400. Tệp quá lớn nhận 413.

## Functional Requirements

- **FR-001**: `schoolId` luôn lấy từ phiên đăng nhập; client không truyền mã trường.
- **FR-002**: `GET /schools/me/brand` chỉ cần đăng nhập và thuộc một trường. Tên và logo trường vốn đã công khai trên trang trường, nên không cần quyền riêng.
- **FR-003**: Đổi hoặc gỡ logo dùng quyền có sẵn `school.manage`, giới hạn ở vai trò `SCHOOL_ADMINISTRATION`. Thao tác ghi chạy trong `withSchoolTransaction`: nạp lại quyền từ DB và chặn khi trường không còn hoạt động.
- **FR-004**: Kiểm tra quyền chạy trước middleware nhận tệp.
- **FR-005**: Ảnh tải lên qua `cloudinaryUpload.uploadImage` với namespace `school-logos` và owner là `schoolId`. Ảnh cũ không bị xóa trên Cloudinary.
- **FR-006**: Không đổi schema, không thêm quyền mới, không có migration.

## Ngoài phạm vi

- Đổi tên, địa chỉ hay các thông tin khác của trường.
- Xóa ảnh logo cũ trên Cloudinary.
