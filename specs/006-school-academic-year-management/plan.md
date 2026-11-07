# Implementation Plan: BGH quản lý niên khóa toàn trường

## Summary

Tạo module `school-academic-year` theo kiến trúc routes/controller/validation/DTO/service/repository, mount dưới `/api/schools/me/academic-years`. Tái sử dụng model hiện có, thêm hai permission catalog và màn hình BGH responsive trên FE.

## Technical Decisions

- Module riêng vì resource có list/detail/create/update và validation holiday độc lập; không mở rộng Organization service.
- Label bất biến sau khi tạo; PATCH chỉ cập nhật khoảng ngày và holidays.
- Date-only được nhận/xuất bằng chuỗi `YYYY-MM-DD`; repository chuyển sang `Date` tại UTC và service serialize bằng phần ngày ISO.
- Service dùng `withSchoolTransaction` cho create/update; repository nhận transaction client và luôn lọc `schoolId`.
- Không có thay đổi schema hoặc migration.
- FE dùng `AcademicYearService`, MUI và token hiện có; selector + form là một workspace, table chuyển thành cards ở mobile.

## Authorization

- `school_academic_year.view`: list/detail.
- `school_academic_year.manage`: create/update.
- Cả hai grant mặc định duy nhất cho `SCHOOL_MANAGEMENT_BOARD`.
- Service kiểm tra role/org/school ngoài permission middleware để bảo vệ khi gọi nội bộ.

## Verification

- Unit/API tests cho validation, route permission, tenant scope, create/update và conflict.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, test liên quan.
- FE `npm run build`, render desktop/mobile và detector của Impeccable.
