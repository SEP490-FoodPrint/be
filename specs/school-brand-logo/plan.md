# Implementation Plan: Logo trường trên giao diện nhân sự nhà trường

**Spec**: `specs/school-brand-logo/spec.md`

## Thiết kế

Toàn bộ thay đổi nằm trong module `organization`, cạnh các API `/schools/me/*` sẵn có (chế độ nấu, giờ phục vụ).

| Lớp        | Thay đổi                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| routes     | `GET /me/brand`; `PUT /me/logo` (`requirePermission("school.manage")` → `authorizeSchoolLogo` → `createUpload("logo", 1)`); `DELETE /me/logo`                  |
| controller | `getSchoolBrand`, `authorizeSchoolLogo` (chạy trước multer), `updateSchoolLogo`, `removeSchoolLogo`                                                            |
| validation | `schoolLogoUploadSchema` và envelope rỗng (`z.strictObject`), lỗi tiếng Việt qua `OrganizationValidationError`                                                 |
| service    | `assertSchoolMember`, `assertSchoolProfileManager`; tải ảnh rồi cập nhật `logoUrl` trong `withSchoolTransaction`; map tường minh sang `SchoolBrandResponseDTO` |
| repository | `findSchoolBrand`, `updateSchoolLogo` (select `id`, `name`, `logoUrl`)                                                                                         |
| middleware | export `createUpload` từ `ingredient-upload.middleware.ts` để dùng lại                                                                                         |

## Kiểm thử

`tests/school-brand.test.ts`:

- service đọc đúng trường trong phiên và chặn tài khoản ngoài trường;
- chỉ Quản trị nhà trường có `school.manage` được đổi hoặc gỡ logo, và không có lượt tải nào khi bị chặn;
- route trả 200 cho người có quyền, 400 khi không phải multipart, 403 trước khi nhận tệp khi thiếu quyền.

## Rủi ro

- Ảnh cũ không bị xóa trên Cloudinary nên tốn thêm dung lượng; chấp nhận được vì logo ít khi đổi.
