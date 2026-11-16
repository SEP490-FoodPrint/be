# Implementation Plan: Multi-grade menu authoring

## Technical Context

TypeScript strict, Express, Zod, Prisma/PostgreSQL; FE React/MUI/SCSS. Tái sử dụng WeeklyMenu, WeeklyMenuGrade và snapshots MenuDayDishIngredient/MealSeasoning. Không thay schema và không chạy migration/seed.

## Research Decisions

Tách persistence từng khối thay vì thêm chiều khối vào mọi bảng chế biến/phân bổ. Giữ API cũ, bổ sung batch API có giao dịch Serializable. Lấy công thức riêng từng khối, không bỏ điều kiện khác định lượng của API công thức cũ. Gộp trình bày bằng chữ ký lịch món bỏ số lượng, có trạng thái và phương án suất riêng. Không cần nghiên cứu công nghệ mới.

## Constitution Check

I. Quyền và tenant: menu.view/create/update, class_allergy.view; recheck actor trong transaction.
II. Dữ liệu: dùng bảng hiện có, giữ snapshots và lịch sử; không tồn kho ngoài luồng bếp.
III. Kiến trúc: controller -> validation -> service/DTO -> repository; không query Prisma trong service.
IV. Giao dịch: nhiều khối cùng một transaction; rollback lỗi; khóa/serialization theo cơ chế hiện có.
V. Kiểm thử: unit API/validation, rollback, công thức theo khối, FE contract và grouping; validate và test:unit.
VI. Spec/branch: spec cùng slug với nhánh; không thay scaffold; PR BE vào dev, FE vào main. Không có ngoại lệ cần duyệt.

## Structure and Contracts

- POST /v1/menus/grade-batch: MenuWrite với gradeIds bắt buộc, submit tùy chọn; server lấy công thức từng khối. Trả menus (id, gradeIds, status), allergyChecks có gradeId/name và hasUnresolvedAllergies.
- POST /v1/menus/submit-group: menuIds duy nhất; gửi các thực đơn hiện có nguyên tử sau kiểm tra ownership và trạng thái.
- FE preview: gọi recipe-preview và allergy-check độc lập từng khối; hiển thị selector khối, giữ cảnh báo và nguyên liệu đúng ngữ cảnh.
- FE save: một batch request; gửi duyệt cùng batch khi an toàn; không lặp POST độc lập từng khối.
- Danh sách: giữ variants/IDs trong nhóm; chỉ gộp lịch món và trạng thái tương đương; sửa chi tiết vẫn có khối được chọn rõ ràng.

## Validation Strategy

### Reopening fix

User follow-up: apply an assigned-scope predicate (school-wide flag or at least one grade relation) to repository list/count, summaries and week choices. Add the same guard to frontend cards, grade options and comparison for compatibility with cached/older responses. Preserve legitimate school-wide menus and school grade options without menus. No data deletion.

Share pure holiday/week completeness checks between menu submission and both approval services, using school-scoped calendar reads inside the existing transaction. Preserve `isSchoolWide` through the week API and frontend adapters. Exclude unassigned records from selected-grade authoring, retain status guards and grade snapshots, and render daily progress from actual daily data. Test a one-day draft, a five-day lunch-only week, calendar holidays, reopening with an unassigned legacy record, and mixed daily/weekly states. No migration or Azure writes.

Unit phải chứng minh recipe khác định lượng, shared selection, khối ngoại trường, thiếu recipe, dị ứng một khối, khóa đã duyệt, submit rollback và gửi đúng API. Chạy npm run validate, npm run test:unit và FE test/build. Test PostgreSQL thật chỉ dùng DB local disposable cấu hình rõ; không dùng Azure để chạy test.
