## Loại PR

<!-- Đánh dấu một lựa chọn. Xem contribute.md mục 8. -->

- [ ] **Có spec**: PR thay đổi `src/**` hoặc `prisma/**`, hoặc chỉ sửa spec
- [ ] **Miễn spec**: tài liệu, CI, test, tooling; nhánh `revert/*`; PR `dev` → `main`

**Spec:** `specs/NNN-slug/` <!-- bỏ trống nếu miễn spec -->

## Thay đổi

<!-- Vấn đề cần giải quyết, hành vi/cấu hình sau thay đổi, issue liên quan. -->

## Kiểm tra

<!-- Lệnh đã chạy và kết quả PASS/FAIL/BLOCKED, ví dụ: -->

- [ ] `npm run validate`
- [ ] `npm run test:unit`
- [ ] Kiểm tra bổ sung theo contribute.md mục 6:

## Checklist

- [ ] Nhánh đúng quy tắc (`<feat|fix|refactor|perf>/NNN-slug` nếu có spec) và base là `dev`
- [ ] `spec.md`, `plan.md`, `tasks.md` khớp với code; không còn `NEEDS CLARIFICATION`
- [ ] Mục Constitution Check trong `plan.md` PASS hoặc ngoại lệ đã được ghi rõ lý do
- [ ] Commit `docs(spec): ...` đứng trước commit code để reviewer đọc spec trước
- [ ] Không có credential, `.env`, dump, generated client hay `.specify/feature.json`
