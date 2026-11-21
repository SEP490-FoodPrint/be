# Tasks: Logo trường trên giao diện nhân sự nhà trường

- [x] T001 Thêm `findSchoolBrand`, `updateSchoolLogo` vào `src/modules/organization/organization.repository.ts`
- [x] T002 Thêm schema tải logo vào `organization.validation.ts`, `organization.request.dto.ts`, và `SchoolBrandResponseDTO` vào `organization.response.dto.ts`
- [x] T003 Thêm `getSchoolBrand`, `authorizeSchoolLogo`, `updateSchoolLogo`, `removeSchoolLogo` vào `organization.service.ts`
- [x] T004 Thêm controller và route `GET /me/brand`, `PUT /me/logo`, `DELETE /me/logo`; export `createUpload`
- [x] T005 Viết `tests/school-brand.test.ts`, thêm vào `test:unit`, cập nhật repository giả trong `tests/organization.test.ts`
- [ ] T006 Kiểm thử thủ công: Quản trị nhà trường tải logo, BGH và GVCN thấy logo mới ở sidebar
